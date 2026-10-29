# Exporting a review copy

Run rig locally with the sample data and the lane marker in your untracked `.env`.
With the service running, export the digest using Node 22+:

```sh
node scripts/export-preview.mjs ../private/digest.html
```

The destination directory must already exist outside every Git checkout. The command
defaults to `http://localhost:8787/digest/2026-10-28`; pass a second argument for another
local port or night. It checks the HTTP response, the lane banner and self-contained HTML
before replacing the output. A failed request leaves any previous copy untouched.

Do not commit the HTML, put it in an issue, or attach it to chat. After the human approves
publishing, upload this one file to an overwritable public HTTPS URL. Send that URL and
the plan's issue list to the reviewer. Issue #7 remains open until the reviewer receives them.

After review arrives, obtain the human's separate cleanup approval. Restart rig with
`LANE_MARKER` unset or empty (clear it in `.env` too), export again, and replace the file
at the same public URL. Check the public page says `no marker set` and no longer contains
the marker. Archive the plan with its issue list as part of issue #8.
