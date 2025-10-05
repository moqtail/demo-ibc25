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
This module produces a timeline track.
It connects to an API endpoint that provides events.
Using those events, it produces a timeline track.
The API endpoint is called each second (this can be adjusted by a parameter).
There  is a  polling method that returns the latest timeline track.

The timeline track is a JSON object that contains a list of timeline records.
Each timeline record contains a media_pts, group_id, object_id, wallclock, and metadata.

The API return the following sample data:
{
  "id": 91,
  "channelId": 7,
  "startTime": "2024-04-08T00:25:00Z",
  "endTime": "2024-04-08T03:30:00Z",
  "title": "Benfica x Sporting",
  "state": "COMPLETED",
  "type": "liga-betclic",
  "leagueName": "Liga Betclic",
  "thumbnailsUrl": "http://demo.sixfloorsolutions.com:8000/pointers-nba-img/7_91/low/",
  "events": [
    {
      "id": 58935,
      "type": "GAME_START",
      "thumbnail": "198.jpg",
      "offset": 198,
      "duration": 11
    },
    {
      "id": 58927,
      "title": "2-0 [0]",
      "type": "2_POINT",
      "thumbnail": "216.jpg",
      "offset": 209,
      "duration": 7,
      "team": "SLB",
      "teamId": 201,
      "subEvents": [
        {
          "title": "2-0 [0]",
          "type": "2_POINT",
          "thumbnail": "216.jpg",
          "offset": 209,
          "duration": 7,
          "team": "SLB",
          "metadata": {
            "away": 2,
            "home": 0,
            "clock": 591,
            "period": "Q1",
            "shot-clock": 18
          }
        }
      ],
      "metadata": {
        "away": 0,
        "home": 2,
        "clock": 591,
        "period": "Q1",
        "shot-clock": 18
      }
    },
*/

use crate::models::TrackEvent;
use crate::timeline::Timeline;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::mpsc::UnboundedSender;
use tokio::time::Duration;
use tracing::{debug, error, warn};

#[derive(Clone)]
pub struct TimelineProducer {
    pub api_endpoint: String,
    pub poll_interval: u64,
    pub sender: Arc<Mutex<UnboundedSender<Vec<TrackEvent>>>>,
}

impl TimelineProducer {
    pub fn new(
        api_endpoint: String,
        poll_interval: u64,
        sender: Arc<Mutex<UnboundedSender<Vec<TrackEvent>>>>,
    ) -> Self {
        Self {
            api_endpoint,
            poll_interval,
            sender,
        }
    }

    pub fn start(&self) {
        let sender = self.sender.clone();
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                let timeline = this.get_timeline().await;
                if timeline.is_none() {
                    warn!("No timeline received from API");
                    tokio::time::sleep(Duration::from_secs(this.poll_interval)).await;
                    continue;
                }
                let sender = sender.lock().await;
                match sender.send(vec![TrackEvent::Timeline(timeline.unwrap())]) {
                    Ok(_) => (),
                    Err(e) => error!("Error sending timeline: {:?}", e),
                }
                drop(sender);
                tokio::time::sleep(Duration::from_secs(this.poll_interval)).await;
            }
        });
    }

    pub async fn get_timeline(&self) -> Option<Timeline> {
        let response = reqwest::get(self.api_endpoint.clone()).await.unwrap();
        if response.status() != 200 {
            warn!(
                "Failed to get timeline from API: HTTP {}",
                response.status()
            );
            return None;
        }

        let body = response.text().await.unwrap();
        debug!("Timeline API response: {}", body);
        let timeline = serde_json::from_str::<Timeline>(&body)
            .map_err(|e| {
                warn!(
                    "Failed to parse timeline JSON: {}. Response body: {}",
                    e, body
                );
                e
            })
            .unwrap();
        Some(timeline)
    }
}
