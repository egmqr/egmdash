# Manage Photos Task Queue

## Scope

Update the EGM dashboard's **Manage Photos** modal only. `polo-booth-gallery` has no matching management modal, so no gallery changes are in scope.

## Goal

Keep photo browsing available while uploads or deletions run, and safely serialize new requests instead of allowing overlapping operations.

## Interface

The Manage Photos modal will have a persistent task panel directly below its header and above the upload controls and grid. The panel will show:

- the active operation and item progress;
- count and short list of queued operations;
- completed and failed state for the current operation;
- a visible message: "Keep this window open. Closing it interrupts active and queued tasks."

The grid remains usable while the panel is visible. The modal may still be closed, but closing it is explicitly warned against and cancels browser-owned work.

## Queue behavior

One in-memory FIFO queue serves Manage Photos uploads and deletions. A file-picker selection creates one upload task containing its selected files. A single deletion creates one delete task; selected-photo deletion creates one batch-delete task.

When a task is added while another task runs, EGM shows a toast stating that it was queued and its position. Only one task runs at a time. A task failure is recorded in the panel, reported to the user, and does not stop later queued tasks.

Each task refreshes the photo grid after it finishes, preserving selection when possible. Existing auto-refresh remains unchanged.

## Boundaries

No server or `polo-booth-gallery` changes. Queue lifetime is only the open Manage Photos modal/browser page; it is not persisted or recoverable after closing/reloading.

## Verification

- Automated tests cover FIFO ordering, queued-position messaging, and continued processing after a failed task.
- Manual browser check: trigger upload, browse/select photos, queue deletion, confirm panel updates and operations run in order.
