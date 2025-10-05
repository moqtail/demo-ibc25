// Copyright 2025 The MOQtail Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use anyhow::Result;
use byteorder::{BigEndian, ReadBytesExt};
use bytes::Bytes;
use bytes::BytesMut;
use mp4::{MoofBox, MoovBox, ReadBox};
use std::sync::Arc;
use std::{collections::HashMap, io::Cursor};
use tokio::sync::Mutex;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    sync::mpsc::UnboundedSender,
};
use tracing::{debug, info, warn};

use crate::catalog::{Catalog, CatalogTrack, PackagingType};
use crate::models::{FrameData, TimeEvent, TrackEvent, TrackType};

pub struct Mp4StreamProcessor {
    buffer: BytesMut,
    state: ProcessorState,
    init_segment: BytesMut,
    last_moof: BytesMut,
    tx: Arc<Mutex<UnboundedSender<Vec<TrackEvent>>>>,
    moov_processed: bool,
    ftyp_processed: bool,
    frame_count: u64,
    is_keyframe: bool,
    track_map: HashMap<u32, TrackType>,
    codec_map: HashMap<u32, String>,
    last_track_id: u32,
    last_track_type: TrackType,
    last_ntp_timestamp: u64,
    last_media_time: u64,
    keyframe_count: u64,
    last_group_frame_count: u32,
    last_prft_box: Bytes,
    track_object_counters: HashMap<u32, u64>,
}

#[derive(Debug)]
enum ProcessorState {
    ReadingBoxHeader,
    ReadingBoxData { box_type: [u8; 4], box_size: u64 },
}

impl Mp4StreamProcessor {
    pub fn new(tx: Arc<Mutex<UnboundedSender<Vec<TrackEvent>>>>) -> Self {
        Self {
            buffer: BytesMut::new(),
            state: ProcessorState::ReadingBoxHeader,
            init_segment: BytesMut::new(),
            last_moof: BytesMut::new(),
            tx,
            moov_processed: false,
            ftyp_processed: false,
            frame_count: 0,
            is_keyframe: false,
            track_map: HashMap::new(),
            codec_map: HashMap::new(),
            last_track_id: 0,
            last_track_type: TrackType::Other,
            last_ntp_timestamp: 0,
            last_media_time: 0,
            keyframe_count: 0,
            last_group_frame_count: 0,
            last_prft_box: Bytes::new(),
            track_object_counters: HashMap::new(),
        }
    }

    pub async fn process_stream<R: AsyncRead + Unpin + Send + 'static>(
        &mut self,
        mut reader: R,
    ) -> Result<()> {
        info!("Reading MP4 stream from provided reader...");

        let mut read_buffer = [0u8; 8192];

        // Add a timeout to detect if no data is coming
        let timeout_duration = std::time::Duration::from_secs(5);
        info!(
            "Waiting for data on stream (timeout: {}s)...",
            timeout_duration.as_secs()
        );

        loop {
            let read_result =
                tokio::time::timeout(timeout_duration, reader.read(&mut read_buffer)).await;

            match read_result {
                Ok(Ok(0)) => {
                    info!("End of input stream");
                    break;
                }
                Ok(Ok(n)) => {
                    debug!("Read {} bytes from stream", n);
                    self.buffer.extend_from_slice(&read_buffer[..n]);
                    self.process_buffer().await?;
                }
                Ok(Err(e)) => {
                    warn!("Error reading from stream: {}", e);
                    break;
                }
                Err(_) => {
                    warn!(
                        "Timeout waiting for stream data - no data received in {}s",
                        timeout_duration.as_secs()
                    );
                    warn!("Make sure the input source is piping data to this process");
                    return Err(anyhow::anyhow!("Timeout waiting for stream data"));
                }
            }
        }

        Ok(())
    }

    async fn process_buffer(&mut self) -> Result<()> {
        loop {
            match &self.state {
                ProcessorState::ReadingBoxHeader => {
                    if self.buffer.len() < 8 {
                        // Need at least 8 bytes for box header (size + type)
                        break;
                    }

                    let size = u32::from_be_bytes([
                        self.buffer[0],
                        self.buffer[1],
                        self.buffer[2],
                        self.buffer[3],
                    ]) as u64;

                    let box_type = [
                        self.buffer[4],
                        self.buffer[5],
                        self.buffer[6],
                        self.buffer[7],
                    ];

                    let (actual_size, _header_size) = if size == 1 {
                        // Extended 64-bit size format: [4 bytes size=1][4 bytes type][8 bytes extended_size][data...]
                        if self.buffer.len() < 16 {
                            break; // Need more data
                        }
                        let extended_size = u64::from_be_bytes([
                            self.buffer[8],
                            self.buffer[9],
                            self.buffer[10],
                            self.buffer[11],
                            self.buffer[12],
                            self.buffer[13],
                            self.buffer[14],
                            self.buffer[15],
                        ]);
                        (extended_size, 16u64) // 16 bytes header for extended format
                    } else {
                        // Standard format: [4 bytes size][4 bytes type][data...]
                        (size, 8u64) // 8 bytes header for standard format
                    };

                    debug!(
                        "Found MP4 box: {} (size: {} bytes)",
                        String::from_utf8_lossy(&box_type),
                        actual_size
                    );

                    self.state = ProcessorState::ReadingBoxData {
                        box_type,
                        box_size: actual_size,
                    };
                }
                ProcessorState::ReadingBoxData { box_type, box_size } => {
                    // MP4 box format: [4 bytes size][4 bytes type][data...] (standard)
                    // or: [4 bytes size=1][4 bytes type][8 bytes extended_size][data...] (extended)

                    if (self.buffer.len() as u64) < *box_size {
                        // Need more data
                        break;
                    }

                    let box_data = self.buffer.split_to(*box_size as usize);
                    debug!(
                        "box_data length: {:?} box_size: {:?} self.buffer.len(): {:?}",
                        box_data.len(),
                        *box_size,
                        self.buffer.len()
                    );

                    self.process_box(*box_type, box_data).await?;

                    self.state = ProcessorState::ReadingBoxHeader;
                }
            }
        }
        Ok(())
    }

    async fn process_box(&mut self, box_type: [u8; 4], data: BytesMut) -> Result<()> {
        let box_type_str = String::from_utf8_lossy(&box_type);

        match &box_type {
            b"ftyp" => {
                self.process_ftyp_box(data).await?;
            }
            b"moov" => {
                self.process_moov_box(data).await?;
            }
            b"moof" => {
                self.process_moof_box(data).await?;
            }
            b"mdat" => {
                self.process_mdat_box(data).await?;
            }
            b"prft" => {
                self.process_prft_box(data).await?;
            }
            _ => {
                debug!("Skipping unknown box type: {}", box_type_str);
            }
        }

        Ok(())
    }

    async fn process_ftyp_box(&mut self, data: BytesMut) -> Result<()> {
        if !self.ftyp_processed {
            info!("processing ftyp box (size: {} bytes)", data.len());
            self.init_segment.extend_from_slice(&data);
            info!("init_segment: {:?}", self.init_segment);
            self.ftyp_processed = true;
        } else {
            warn!("Skipping ftyp box. Already processed");
        }
        Ok(())
    }

    async fn process_moov_box(&mut self, data: BytesMut) -> Result<()> {
        if !self.moov_processed {
            debug!("processing moov box (size: {} bytes)", data.len());

            self.init_segment.extend_from_slice(&data);

            // Build track map from moov box data
            match self.build_track_map_from_moov(&data) {
                Ok((track_map, codec_map)) => {
                    self.track_map = track_map;
                    self.codec_map = codec_map;
                    info!("Built track map with {} tracks", self.track_map.len());
                    for (track_id, kind) in &self.track_map {
                        let unknown_codec = "unknown".to_string();
                        let codec = self.codec_map.get(track_id).unwrap_or(&unknown_codec);
                        info!("Track {}: {:?} (codec: {})", track_id, kind, codec);
                    }
                }
                Err(e) => {
                    warn!("Failed to build track map from moov box: {:?}", e);
                }
            }

            // now build the catalog
            let mut catalog = Catalog::new(vec![]);
            let mut depends = vec![];
            for (track_id, track_type) in &self.track_map {
                use crate::catalog::PackagingType;
                let codec = self
                    .codec_map
                    .get(track_id)
                    .unwrap_or(&"unknown".to_string())
                    .clone();
                // init data is base64 encoded
                use base64::{Engine as _, engine::general_purpose};
                let init_data = general_purpose::STANDARD.encode(&self.init_segment);
                depends.push(track_id.to_string());
                catalog.tracks.push(CatalogTrack::new(
                    track_id.to_string(),
                    1,                             // render_group
                    PackagingType::ChunkPerObject, // packaging
                    true,                          // is_live
                    track_type.to_string(),        // role
                    codec,                         // codec
                    0,                             // width
                    0,                             // height
                    0,                             // bitrate
                    0,                             // framerate
                    1,                             // alt_group
                    Some(init_data),               // init_data
                    None,                          // mime_type
                    None,                          // depends
                ));
            }
            // add the timeline track
            catalog.tracks.push(CatalogTrack::new(
                "timeline".to_string(),
                1,                            // render_group
                PackagingType::Timeline,      // packaging
                true,                         // is_live
                "timeline".to_string(),       // role
                "".to_string(),               // codec
                0,                            // width
                0,                            // height
                0,                            // bitrate
                0,                            // framerate
                1,                            // alt_group
                None,                         // init_data
                Some("text/csv".to_string()), // mime_type
                Some(depends),                // depends
            ));
            self.tx
                .lock()
                .await
                .send(vec![TrackEvent::Catalog(catalog)])
                .unwrap();

            self.moov_processed = true;
        } else {
            warn!("Skipping moov box. Already processed");
        }
        Ok(())
    }

    async fn process_prft_box(&mut self, data: BytesMut) -> Result<()> {
        let mut cursor = Cursor::new(data.as_ref());

        // Read size and type (already known to be 'prft')
        let _size = ReadBytesExt::read_u32::<BigEndian>(&mut cursor)?;
        let _box_type = ReadBytesExt::read_u32::<BigEndian>(&mut cursor)?;

        // Read FullBox fields (version and flags)
        let version = ReadBytesExt::read_u8(&mut cursor)?;
        let _flags = ReadBytesExt::read_u24::<BigEndian>(&mut cursor)?;

        ReadBytesExt::read_u32::<BigEndian>(&mut cursor)?;
        let ntp_timestamp = ReadBytesExt::read_u64::<BigEndian>(&mut cursor)?;

        let media_time = if version == 0 {
            ReadBytesExt::read_u32::<BigEndian>(&mut cursor)? as u64
        } else {
            ReadBytesExt::read_u64::<BigEndian>(&mut cursor)?
        };

        self.last_ntp_timestamp = ntp_timestamp;
        self.last_media_time = media_time;
        self.last_prft_box = data.freeze();

        Ok(())
    }

    async fn process_moof_box(&mut self, data: BytesMut) -> Result<()> {
        debug!("processing moof box (size: {} bytes)", data.len());

        self.last_track_id = Self::get_track_id_from_moof(&data)?;
        self.last_track_type = Self::get_track_type(self.last_track_id, &self.track_map);

        // Parse the moof box to detect keyframes
        self.is_keyframe =
            self.parse_moof_for_keyframe(&data) && self.last_track_type == TrackType::Video;

        if self.is_keyframe {
            info!(
                "🔑 Keyframe flag detected in moof box! Last group's frame count: {}",
                self.last_group_frame_count
            );
            self.keyframe_count += 1;
            self.last_group_frame_count = 1;

            // Reset object counters for all tracks when keyframe is detected
            self.track_object_counters.clear();
            info!("Reset object counters for all tracks due to keyframe");

            self.tx
                .lock()
                .await
                .send(vec![
                    TrackEvent::Keyframe(FrameData::new(
                        self.last_track_id.to_string(),
                        self.last_track_type,
                        self.last_moof.clone().freeze(),
                        self.keyframe_count,
                        1, // Keyframe always gets object_id = 1 after reset
                    )),
                    TrackEvent::TimeEvent(TimeEvent::new(
                        self.last_track_id,
                        self.last_ntp_timestamp,
                        self.last_media_time,
                        self.keyframe_count,
                    )),
                ])
                .unwrap();
            self.last_moof.clear();
        } else {
            self.last_group_frame_count += 1;
        }

        // Store the moof data for later use
        self.last_moof = data;
        Ok(())
    }

    async fn process_mdat_box(&mut self, data: BytesMut) -> Result<()> {
        debug!(
            "Media Data Box - contains actual media samples (size: {} bytes)",
            data.len()
        );

        // Debug: show first 32 bytes of the mdat data
        let preview_len = std::cmp::min(32, data.len());
        let preview: Vec<String> = data[..preview_len]
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect();
        debug!("First {} bytes of mdat: {}", preview_len, preview.join(" "));

        // Increment the object counter for this track
        let current_object_id = self
            .track_object_counters
            .entry(self.last_track_id)
            .and_modify(|counter| *counter += 1)
            .or_insert(1);
        let object_id = *current_object_id;

        // Create payload with moof + mdat
        let mut payload = BytesMut::from(self.last_prft_box.clone());
        payload.extend_from_slice(&self.last_moof);
        payload.extend_from_slice(&data);

        // if we have a keyframe
        if self.is_keyframe {
            self.is_keyframe = false;
        }
        self.tx
            .lock()
            .await
            .send(vec![TrackEvent::Frame(FrameData::new(
                self.last_track_id.to_string(),
                self.last_track_type,
                payload.freeze(),
                self.keyframe_count,
                object_id,
            ))])
            .unwrap();

        self.frame_count += 1;
        Ok(())
    }

    fn parse_moof_for_keyframe(&self, moof_data: &BytesMut) -> bool {
        // Parse moof box structure to find keyframe flags
        // moof contains traf (track fragment) boxes
        // traf contains trun (track fragment run) boxes with sample flags
        let mut cursor = Cursor::new(moof_data.as_ref());
        cursor.set_position(8);

        debug!(
            "Parsing moof box for keyframe, moof len: {}",
            moof_data.len()
        );

        // Try to parse the moof box using the mp4 crate
        let size_to_read = moof_data.len() as u64 - 8;
        match mp4::MoofBox::read_box(&mut cursor, size_to_read) {
            Ok(moof_box) => {
                debug!(
                    "Successfully parsed moof box with {} track fragments",
                    moof_box.trafs.len()
                );

                for traf in moof_box.trafs.iter() {
                    // TODO trak default flags if this is None
                    let default_flags = traf.tfhd.default_sample_flags.unwrap_or_default();
                    let trun = match &traf.trun {
                        Some(t) => t,
                        None => return false,
                    };

                    for j in 0..trun.sample_count {
                        let flags = if j == 0 && trun.first_sample_flags.is_some() {
                            trun.first_sample_flags.unwrap()
                        } else {
                            match trun.sample_flags.get(j as usize) {
                                Some(f) => *f,
                                None => default_flags,
                            }
                        };

                        // https://chromium.googlesource.com/chromium/src/media/+/master/formats/mp4/track_run_iterator.cc#207
                        // sample depends on no other and is non sync
                        let keyframe = (flags >> 24) & 0x3 == 0x2;
                        // sample is non sync
                        let k_sample_is_non_sync_sample = 0x10000;
                        let is_sync_sample =
                            (flags & k_sample_is_non_sync_sample) != k_sample_is_non_sync_sample;

                        if keyframe && is_sync_sample {
                            return true;
                        }
                    }
                }

                debug!("No keyframe flags found in moof box");
                false
            }
            Err(e) => {
                debug!("Failed to parse moof box: {:?}", e);
                // Fallback to simple heuristic - assume every 25th frame is a keyframe
                // based on your ffmpeg settings (-g 25)
                self.frame_count % 25 == 0
            }
        }
    }

    fn build_track_map_from_moov(
        &self,
        moov_data: &BytesMut,
    ) -> Result<(HashMap<u32, TrackType>, HashMap<u32, String>)> {
        let mut cursor = Cursor::new(moov_data.as_ref());
        cursor.set_position(8); // Skip box size and type

        let size_to_read = moov_data.len() as u64 - 8;
        let moov_box = MoovBox::read_box(&mut cursor, size_to_read)?;

        let mut track_map = HashMap::new();
        let mut codec_map = HashMap::new();

        for track in &moov_box.traks {
            let track_id = track.tkhd.track_id;

            // Determine track kind from media handler type
            let handler_fourcc = track.mdia.hdlr.handler_type;
            let track_type = match &handler_fourcc.value {
                b"vide" => TrackType::Video,
                b"soun" => TrackType::Audio,
                _ => TrackType::Other,
            };

            // Extract codec information from sample description
            let codec = {
                let stsd = &track.mdia.minf.stbl.stsd;
                // Check for common video codecs
                if stsd.avc1.is_some() {
                    /*
                    format:
                    `${baseCodec}.${decimalToHex(this.avcC.AVCProfileIndication)}${decimalToHex(this.avcC.profile_compatibility)}${decimalToHex(this.avcC.AVCLevelIndication)}`
                    */
                    let val = stsd.avc1.as_ref().unwrap();
                    let avc_profile_indication = val.avcc.avc_profile_indication;
                    let avc_profile_compatibility = val.avcc.profile_compatibility;
                    let avc_level = val.avcc.avc_level_indication;
                    format!(
                        "avc1.{:X}{:X}{:X}",
                        avc_profile_indication, avc_profile_compatibility, avc_level
                    )
                } else if stsd.hev1.is_some() {
                    "hev1".to_string()
                } else if stsd.vp09.is_some() {
                    "vp09".to_string()
                } else if stsd.mp4a.is_some() {
                    // TODO: get the actual codec
                    "mp4a.40.2".to_string()
                } else if stsd.tx3g.is_some() {
                    "tx3g".to_string()
                } else {
                    warn!("Unknown codec: {:?}", stsd);
                    "unknown".to_string()
                }
            };

            info!(
                "Found track {}: {:?} (handler: {:?}, codec: {})",
                track_id,
                track_type,
                String::from_utf8_lossy(&handler_fourcc.value),
                codec
            );

            track_map.insert(track_id, track_type);
            codec_map.insert(track_id, codec);
        }

        Ok((track_map, codec_map))
    }

    fn get_track_id_from_moof(moof_bytes: &[u8]) -> Result<u32> {
        let mut cursor = Cursor::new(moof_bytes);
        cursor.set_position(8);
        let moof = MoofBox::read_box(&mut cursor, moof_bytes.len() as u64 - 8)?;

        // Assume one traf per moof (common case)
        if !moof.trafs.is_empty() {
            let traf = &moof.trafs[0];
            debug!(
                "get_track_id_from_moof | Track id: {:?}",
                traf.tfhd.track_id
            );
            Ok(traf.tfhd.track_id)
        } else {
            Err(anyhow::anyhow!("No track fragments found in moof"))
        }
    }

    fn get_track_type(track_id: u32, track_map: &HashMap<u32, TrackType>) -> TrackType {
        *track_map.get(&track_id).unwrap_or(&TrackType::Other)
    }
}
