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

mod catalog;
mod client;
mod models;
mod mp4_processor;
mod tcp_listener;
mod timeline;
mod timeline_producer;
use anyhow::Result;
use clap::Parser;
use client::Client;
use models::TrackEvent;
use mp4_processor::Mp4StreamProcessor;
use std::env;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task;
use tracing::{error, info};

/// MOQTAIL Publisher - Processes MP4 stream from ffmpeg and publishes via MOQ Transport
#[derive(Parser, Debug, Clone)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Stream name to publish
    #[arg(long, default_value = "test")]
    name: String,

    /// MOQ Transport URL
    #[arg(long, default_value = "https://127.0.0.1:4433")]
    url: String,

    /// Input source for MP4 stream: "stdin" or "tcp"
    #[arg(long, default_value = "stdin")]
    input_source: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Create a shared flag to signal shutdown
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    // Set up the CTRL+C handler
    ctrlc::set_handler(move || {
        println!("CTRL+C pressed! Shutting down...");
        running_clone.store(false, Ordering::SeqCst);
    })
    .expect("Error setting Ctrl-C handler");

    let args = Args::parse();
    info!("Starting MOQTAIL Publisher");
    info!("Stream name: {}", args.name);
    info!("URL: {}", args.url);
    info!("Input source: {}", args.input_source);

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<TrackEvent>>();

    let tx = Arc::new(Mutex::new(tx));

    let client_args = args.clone(); // Clone args for the client task

    task::spawn(async move {
        info!("args: {:?}", client_args);
        let mut client = Client::new(client_args.url.clone(), true, rx);
        client.run().await.unwrap();
    });

    // Start the TCP listener in a separate thread
    task::spawn(async move {
        if let Err(e) = tcp_listener::start_listener().await {
            eprintln!("TCP listener error: {}", e);
        }
    });

    // Start the TCP listener in a separate thread
    // let the_sender = tx.clone();
    // let timeline_poller_task = task::spawn(async move {
    //     // start the timeline producer
    //     let timeline_producer =
    //         TimelineProducer::new("http://localhost:8000/events".to_string(), 3, the_sender);
    //     timeline_producer.start();
    // });

    let the_sender = tx.clone();
    task::spawn(async move {
        let mut processor = Mp4StreamProcessor::new(the_sender);
        match args.input_source.as_str() {
            "stdin" => {
                println!("Processing MP4 stream from stdin...");
                info!("Starting to process stdin...");
                Ok(processor.process_stream(tokio::io::stdin()).await?)
            }
            "tcp" => {
                println!("Processing MP4 stream from TCP socket 12346...");
                info!("Connecting to TCP socket 127.0.0.1:12346...");
                let socket = tokio::net::TcpStream::connect("127.0.0.1:12346").await?;
                info!("Connected to TCP socket.");
                Ok(processor.process_stream(socket).await?)
            }
            _ => Err(anyhow::anyhow!(
                "Invalid input source. Use 'stdin' or 'tcp'."
            )),
        }
    });

    // Wait for tasks to complete
    /*let _ = tokio::join!(
        client_task,
        timeline_poller_task,
        tcp_listener_task,
        mp4_processor_task
    );*/

    loop {
        if !running.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    info!("Finished processing input stream");
    println!("Processing complete.");

    Ok(())
}
