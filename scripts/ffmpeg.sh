#!/bin/bash

INPUT="dev/source.mp4"
URL="https://localhost:4433"
NAME="test"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--input)
			INPUT="$2"
			shift 2
			;;
		--url)
			URL="$2"
			shift 2
			;;
		--name)
			NAME="$2"
			shift 2
			;;
		*)
			echo "Unknown option: $1"
			exit 1
			;;
	esac
done

if [ -z "$URL" ]; then
	echo "URL is not set"
	exit 1
fi

if [ -z "$INPUT" ]; then
	echo "INPUT is not set"
	exit 1
fi

if [ ! -f "$INPUT" ]; then
	echo "INPUT file does not exist"
	exit 1
fi

echo "INPUT: $INPUT"
echo "URL: $URL"
export RUST_LOG=info

# Build the publisher
cargo build --bin moqtail-pub

TEXT="Media Time\:     %{pts\:gmtime\:0\:%T}.%{eif\\:1000*mod(t\\,1)\\:d\\:3}
Publisher Time\: %{localtime\:%T\.%3N}"
DRAW_TEXT_FILTER="drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:fontsize=30:box=1:boxcolor=black@0.75:fontcolor=white:text='$TEXT':x=10:y=10:boxborderw=10"

# Run ffmpeg
ffmpeg -hide_banner -loglevel quiet -probesize 10M -stream_loop -1 -re -i "$INPUT" \
	-filter_complex "[0:v]$DRAW_TEXT_FILTER[vclock]" \
	-fflags nobuffer \
	-map "[vclock]" -map 0:a:0? \
	-f mp4 -c libx264 -movflags cmaf+separate_moof+delay_moov+skip_trailer -x264-params "nal-hrd=cbr" \
	-c:v libx264 \
	-c:a:0 aac -b:a:0 128k \
	-b:v 2M -bufsize 1M -maxrate 2M -minrate 2M \
	-write_prft wallclock \
	-video_track_timescale 90000 \
	-utc_timing_url "https://time.akamai.com/?iso" \
	-framerate 25 -g 50 -keyint_min 50 -force_key_frames "expr:gte(t,n_forced*2)" \
	-profile:v baseline -level 3.0 \
	-sc_threshold:v 0 -streaming 1 -tune zerolatency \
	-frag_type duration -frag_duration 1 - \
	-abort_on 1 | cargo run --bin moqtail-pub -- --url "$URL" --name "$NAME"
