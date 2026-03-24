# Sequential batch release pytest add-on

This add-on focuses on the backend logic that releases **one** request at a time
from a batch to `bridge2.py`.

## What it checks

- only one queued request is released at a time
- no release occurs while another request is `in_progress`
- success can release the next request
- failure policy is made explicit
- published payloads include `bridge2`-critical fields such as `cake_id` and
  `rotation_steps_60`

## Notes

The test file tries a few likely helper names:

- `release_next_batch_request`
- `release_next_request_in_batch`
- `dispatch_next_batch_request`
- `maybe_release_next_batch_request`

If your actual helper name differs, either rename the function or update the
candidate list in the test.
