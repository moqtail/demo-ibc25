# MOQtail with AI-Generated Event Timeline

This demo showcases a streaming pipeline that starts from a MOQ publisher, the moqtail relay, and an AI service that generates an event timeline based on the incoming data.

## Supported Relay Version

This demo uses MOQ Draft 11, you may use commit [`fd691b4`](https://github.com/moqtail/moqtail/tree/fd691b4387c91b72acc4d264d4da092af49b7b0d) of MOQtail as the relay.

## Providing Event Data

The hosted demo at [https://ibc25.moqtail.dev](https://ibc25.moqtail.dev) uses an AI service to generate the event data. You may mock this data by running a REST API server at `http://localhost:8000` that responds to `GET /events/in-range` requests with JSON data in the following format:

```json
GET /events/in-range?start_pts=10000&end_pts=100000

{
  "events": [
    {
      "start_pts": 90000, // in video timebase (90kHz)
      "duration": 5.0, // in seconds
    },
    ...
  ]
}
```

The parsing of this data is located in [`moqtail-pub/src/client.rs#L266`](https://github.com/moqtail/demo-ibc25/blob/main/moqtail-pub/src/client.rs#L266). Entirety of the event object will be sent as `metadata` to the client. Description of that data along with a parser is located in [`moqtail-timeline/src/types.ts#L30`](https://github.com/moqtail/demo-ibc25/blob/main/moqtail-timeline/src/types.ts#L30)
