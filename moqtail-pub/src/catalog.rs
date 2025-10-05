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

use bytes::Bytes;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

// Sample catalog data
/*
{
     "version": 1,
     "generatedAt": 1746104606044,
     "tracks":[
       {
         "name": "hd",
         "renderGroup": 1,
         "packaging": "loc",
         "isLive": true,
         "role": "video",
         "codec":"av01",
         "width":1920,
         "height":1080,
         "bitrate":5000000,
         "framerate":30,
         "altGroup":1
       },
       {
         "name": "md",
         "renderGroup": 1,
         "packaging": "loc",
         "isLive": true,
         "role": "video",
         "codec":"av01",
         "width":720,
         "height":640,
         "bitrate":3000000,
         "framerate":30,
         "altGroup":1
       },
       {
         "name": "sd",
         "renderGroup": 1,
         "packaging": "loc",
         "isLive": true,
         "role": "video",
         "codec":"av01",
         "width":192,
         "height":144,
         "bitrate":500000,
        "framerate":30,
         "altGroup":1
       },
       {
         "name": "audio",
         "renderGroup": 1,
         "packaging": "loc",
         "isLive": true,
         "role": "audio",
         "codec":"opus",
         "samplerate":48000,
         "channelConfig":"2",
         "bitrate":32000
       }
      ]
   }
*/

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum PackagingType {
    #[serde(rename = "loc")]
    LOC,
    #[serde(rename = "chunk-per-object")]
    ChunkPerObject,
    #[serde(rename = "timeline")]
    Timeline,
}

impl PackagingType {
    pub fn to_string(&self) -> String {
        match self {
            PackagingType::LOC => "loc".to_string(),
            PackagingType::ChunkPerObject => "chunk-per-object".to_string(),
            PackagingType::Timeline => "timeline".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Catalog {
    #[serde(rename = "version")]
    pub version: u32, // this is 1
    #[serde(rename = "generatedAt")]
    pub generated_at: u64, // the number of milliseconds that have elapsed since January 1, 1970 (midnight UTC/GMT)
    pub tracks: Vec<CatalogTrack>,
}

impl Catalog {
    pub fn new(tracks: Vec<CatalogTrack>) -> Self {
        let generated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        Self {
            version: 1,
            generated_at,
            tracks,
        }
    }

    pub fn payload(&self) -> Bytes {
        Bytes::from(serde_json::to_string(self).unwrap())
    }

    pub fn to_string(&self) -> String {
        serde_json::to_string(self).unwrap()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CatalogTrack {
    #[serde(rename = "name")]
    pub track_name: String,
    #[serde(rename = "renderGroup")]
    pub render_group: u32,
    #[serde(rename = "packaging")]
    pub packaging: PackagingType,
    #[serde(rename = "isLive")]
    pub is_live: bool,
    #[serde(rename = "role")]
    pub role: String,
    #[serde(rename = "codec")]
    pub codec: String,
    #[serde(rename = "width")]
    pub width: u32,
    #[serde(rename = "height")]
    pub height: u32,
    #[serde(rename = "bitrate")]
    pub bitrate: u32,
    #[serde(rename = "framerate")]
    pub framerate: u32,
    #[serde(rename = "altGroup")]
    pub alt_group: u32,
    #[serde(rename = "initData", skip_serializing_if = "Option::is_none")]
    pub init_data: Option<String>, // Base64 encoded init data
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>, // Base64 encoded init data
    #[serde(rename = "depends", skip_serializing_if = "Option::is_none")]
    pub depends: Option<Vec<String>>, // Base64 encoded init data
}

impl CatalogTrack {
    pub fn new(
        track_name: String,
        render_group: u32,
        packaging: PackagingType,
        is_live: bool,
        role: String,
        codec: String,
        width: u32,
        height: u32,
        bitrate: u32,
        framerate: u32,
        alt_group: u32,
        init_data: Option<String>,
        mime_type: Option<String>,
        depends: Option<Vec<String>>,
    ) -> Self {
        Self {
            track_name,
            render_group,
            packaging,
            is_live,
            role,
            codec,
            width,
            height,
            bitrate,
            framerate,
            alt_group,
            init_data,
            mime_type,
            depends,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap()
    }
}
