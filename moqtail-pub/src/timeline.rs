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

/*
https://datatracker.ietf.org/doc/draft-ietf-moq-warp/
Section 7.1. Timeline track payload

   Each timeline track begins with a header row of
   MEDIA_PTS,GROUP_ID,OBJECT_ID, WALLCLOCK,METADATA.  This row defines
   the 5 columns of data within each record.

   *  MEDIA_PTS: a media timestamp rounded to the nearest millisecond.
      This entry MUST NOT be empty.  If the Object ID entry is present,
      then this value MUST match the media presentation timestamp of the
      first media sample in the referenced Object.

   *  GROUP_ID: the MOQT Group ID.  This entry MAY be empty.

   *  OBJECT_ID: the MOQT Object ID.  This entry MAY be empty.

   *  WALLCLOCK: the wallclock time at which the media was encoded,
      expressed as the number of milliseconds that have elapsed since
      January 1, 1970 (midnight UTC/GMT).  For VOD assets, or if the
      wallclock time is not known, the value SHOULD be 0.


      The format shall be as follows:
      {
        "timeline": [
          {
            "media_pts": 1000,
            "group_id": "1",
            "object_id": "1",
            "wallclock": 1000,
            "metadata": "metadata"
            "version": 1,
          }
        ],
        "version": 1,
        "format_version": 1,
        "generated_at": 1000
      }

      Version will be incremented in each update.
      generated_at will be the number of milliseconds that have elapsed since
      January 1, 1970 (midnight UTC/GMT).
*/

use crate::models::{TrackData, TrackType};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::warn;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Location {
    pub group: u64,
    pub object: u64,
}
// Define a TimelineRecord structure representing a row in the timeline track
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimelineRecord {
    pub media_pts: u64, // Media timestamp in ms
    pub start: Option<Location>,
    pub end: Option<Location>,
    pub wallclock: u64, // Wallclock time in ms since epoch, or 0 if unknown
    pub metadata: Option<String>,
    pub version: u32,
}

impl TimelineRecord {
    pub fn new(
        media_pts: u64,
        start: Option<Location>,
        end: Option<Location>,
        wallclock: u64,
        metadata: Option<String>,
    ) -> Self {
        Self {
            media_pts,
            start,
            end,
            wallclock,
            metadata,
            version: 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Timeline {
    #[serde(default = "default_track_name")]
    pub track_name: String,
    pub version: u32,
    pub format_version: u32,
    pub generated_at: u64,
    #[serde(alias = "timeline")]
    pub records: Vec<TimelineRecord>,
}

fn default_track_name() -> String {
    "timeline".to_string()
}

impl TrackData for Timeline {
    fn track_name(&self) -> String {
        self.track_name.clone()
    }
    fn track_type(&self) -> TrackType {
        TrackType::Timeline
    }
    fn payload(&self) -> Bytes {
        Bytes::from(self.to_json())
    }
}

impl Timeline {
    pub fn new(records: Vec<TimelineRecord>) -> Self {
        Self {
            track_name: "timeline".to_string(),
            version: 0,
            format_version: 1,
            generated_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            records,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap()
    }

    pub fn add_record(&mut self, records: Vec<TimelineRecord>) -> bool {
        // don't allow records if there events with the same media_pts
        let mut changed = false;
        for record in &records {
            if self.records.iter().any(|r| r.media_pts == record.media_pts) {
                warn!("Skipping record with media_pts {:?}", record.media_pts);
                continue;
            }
            changed = true;
            let mut new = record.clone();
            new.version = self.version + 1;
            self.records.push(new);
        }
        if changed {
            // increment version and update generated_at
            self.version += 1;
            self.generated_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
        }
        changed
    }
}
