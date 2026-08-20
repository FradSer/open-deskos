Feature: Home pager gesture control
  The three home pages must respond predictably to a short horizontal swipe on
  the ESP32-P4: one gesture advances or returns exactly one page, without
  release inertia skipping a page or a stale touch point extending a gesture.

  Scenario: A fast left swipe advances only one page
    Given the Shell is showing home page 1
    When the user makes a fast left swipe across the home pager
    Then the pager settles on home page 2
    And it does not pass through or settle on home page 3

  Scenario: A short fast flick advances the adjacent page
    Given the Shell is showing home page 1
    When the user makes a short but intentional fast left flick
    Then LVGL predicts a release endpoint for the flick
    And the pager settles on home page 2
    And the one-page limit prevents the predicted endpoint from reaching home page 3

  Scenario: A fast right swipe returns only one page
    Given the Shell is showing home page 2
    When the user makes a fast right swipe across the home pager
    Then the pager settles on home page 1
    And it does not pass through or settle on a page outside the pager bounds

  Scenario: A short intentional swipe starts paging promptly
    Given the Shell is showing a home page
    When the user moves horizontally beyond the pager drag threshold
    Then the pager begins horizontal scrolling before the touch is released

  Scenario: Native pager movement does not wait for Lua scroll callbacks
    Given LVGL has recognized a horizontal home-pager drag
    When it applies the first raw scroll delta
    Then the page bitmap moves before a Lua scroll callback is dispatched
    And the native page indicator follows the bitmap offset during the drag
    And no Lua scroll event is dispatched for each indicator animation frame

  Scenario: A page indicator continues from an interrupted release snap
    Given a home pager release snap is moving toward an adjacent page
    And its native page indicator is interpolating from the same scroll offset
    When the user begins a reverse drag before the release snap finishes
    Then the page bitmap and indicator continue from their current offset
    And the indicator does not jump to either page endpoint

  Scenario: The script runner cannot preempt LVGL frame production
    Given the GT911 sampler runs on core 0 and LVGL renders on core 1
    When the Shell dispatches Lua events during a pager gesture
    Then the script runner stays on core 0 below the sampler priority
    And its 60 Hz cadence does not add work to every LVGL scroll frame

  Scenario: A physical pager drag emits one end-to-end latency trace
    Given the GT911 sampler observes a home-pager press, move, and release
    When LVGL begins and ends the resulting pager scroll
    Then one trace records sampling, LVGL delivery, scroll, submit, and presentation timing
    And the trace records the maximum queued samples and empty-contact streak
    And no log is emitted for each individual move sample

  Scenario: A pager trace reports a release snap that never finishes
    Given the GT911 sampler observes a home-pager press, move, and release
    And LVGL begins the resulting pager scroll
    When the native scroll-end lifecycle does not complete within the trace timeout
    Then one trace reports an unfinished scroll after the delivered release
    And the trace preserves the recorded input and rendering timing for diagnosis

  Scenario: Performance diagnostics never page a normal device session
    Given the Shell starts without a simulator swipe request or diagnostic sub key
    When the home pager becomes ready
    Then it remains on its selected page until the user touches it
    And native tracing still records a subsequent physical pager gesture

  Scenario: A pager trace separates rendering delay from scanout delay
    Given the GT911 sampler observes a home-pager drag
    When LVGL submits the first rendered pager frame
    Then the gesture trace records the time from scroll begin to flush submission
    And the gesture trace separately records the time from flush submission to presentation

  Scenario: A pager trace separates layout from other refresh preparation
    Given the GT911 sampler observes a home-pager drag
    When LVGL prepares a refresh before it begins rendering
    Then the gesture trace records the layout-update duration
    And the gesture trace separately records the post-layout preparation duration

  Scenario: A pager trace attributes a slow frame without mixing phases
    Given a home-pager gesture produces several display refreshes
    And different refreshes can have different expensive phases
    When the gesture completes
    Then the trace reports bounded slow-frame samples with layout, preparation, render, and flush timing from the same refresh
    And each slow-frame field is emitted as its numeric duration rather than a literal format token
    And it emits those samples only after the gesture has ended
    And it does not log each individual refresh while the user is dragging

  Scenario: A pager trace tags a slow frame with its lifecycle stage
    Given a home pager can be dragging, release-snapping, or restoring live layers
    When LVGL completes an expensive refresh during one of those stages
    Then the trace captures the pager stage at that refresh's start with the same frame sample
    And slow-frame logs identify drag, snap, or restore without per-refresh logging during the gesture

  Scenario: A pager trace attributes pre-render layout work to a display root
    Given LVGL refreshes the active screen and its display layers during a pager gesture
    When a slow pager frame begins before rendering
    Then the trace captures which display roots were layout-dirty before LVGL updates them
    And the trace records bounded elapsed time for each layout-update step with that frame sample
    And the diagnostic does not log individual refreshes while the gesture is active

  Scenario: A pager trace identifies the dirty branch within the active screen
    Given the home screen contains independent pager, status-bar, and peek branches
    When the active screen is layout-dirty during a pager gesture
    Then the trace counts layout-dirty nodes for every display root
    And it separately counts layout-dirty nodes beneath each direct active-screen branch
    And the diagnostic retains only aggregate counts with the slow frame sample

  Scenario: A pager trace identifies the dirty pager child branch
    Given the pager contains three moving bitmap wrappers and one floating live overlay
    When the pager branch is layout-dirty during a gesture
    Then the trace separately counts layout-dirty nodes beneath each direct pager child
    And the trace can distinguish a bitmap wrapper from the live overlay without logging widget identities

  Scenario: A pager trace distinguishes frame pacing from gesture recognition
    Given the GT911 sampler observes a home-pager drag
    When LVGL refreshes the moving pager surface
    Then the gesture trace records the largest gap between refresh starts
    And the trace records the time from the first physical move to scroll begin

  Scenario: Prepared page snapshots replace live content only during pager motion
    Given all home-page snapshots have been prepared while the pager is idle
    And the selected live page is renderer-visible above its cached bitmap
    When LVGL begins a horizontal home-pager scroll
    Then the native pager hook removes the live page layers from rendering before LVGL applies the first scroll delta
    And the snapshot layers remain visible through the drag and release snap
    And switching pager layers does not dirty the home-page layout tree
    And idle snapshot layers are renderer-transparent if the native hook is unavailable
    And no Lua event-queue delay decides which layer renders the first drag frame

  Scenario: A settled pager shows current live widget values above its bitmap cache
    Given all home-page snapshots have been prepared while the pager is idle
    And the clock and calendar widgets have current live values
    When the release snap reaches its final page position
    Then the selected live page is renderer-visible above its cached bitmap
    And the cached bitmap is renderer-transparent while the pager is idle
    And the selected live page is frontmost in the floating input overlay
    And a transparent input guard prevents an unselected page from receiving a gap tap
    And pager page selection does not toggle hidden flags or dirty the layout tree
    And the resting page does not display a stale snapshot instead of its live widgets
    And the calendar day contrasts with its white date tile

  Scenario: Dynamic home values do not rebuild a full-page bitmap while idle
    Given a selected home page has an immutable cached bitmap
    And its clock and calendar widgets have live values
    When those values change on a normal second boundary while the pager is idle
    Then the resting page shows the new live values immediately
    And the Shell does not take another full-page snapshot in the tick path
    And the cached bitmap remains available as the drag background  Scenario: Dynamic home values remain current while their bitmap page moves
    Given a prepared home-page bitmap has an associated lightweight dynamic overlay
    And the clock and calendar widgets have current live values
    When LVGL begins a horizontal home-pager scroll
    Then the native pager hook shows the dynamic overlay above the bitmap
    And the overlay moves with the bitmap page
    And the moving page does not show its boot-time clock or calendar values
    And the native hook hides the dynamic overlay again after the pager settles

  Scenario: Dynamic calendar patches keep their resting geometry during a drag
    Given the resting calendar tile shows the current month and day above its white tile
    And a prepared home-page bitmap is about to replace the live calendar during a drag
    When the native pager hook shows the calendar's dynamic patch
    Then the patch uses the same glyph bounds and baseline as the resting calendar labels
    And the calendar patch does not appear to scale or move at drag start
    And the white calendar tile remains the only backdrop behind the date  Scenario: Dynamic pager patches avoid re-rendering full widget cards
    Given a prepared home-page bitmap has an associated dynamic overlay
    When the pager moves its cached bitmap page
    Then the overlay repaints only fixed-size date and clock text patches
    And the overlay does not construct a grid or rounded home tiles
    And changing a patch label does not make the screen layout content-sized
    And the overlay shows the live calendar day after the pager settles

  Scenario: Dynamic pager text masks do not repaint static tile backgrounds
    Given a prepared home-page bitmap has an associated lightweight dynamic overlay
    When the calendar day or clock changes while its bitmap page moves
    Then only fixed glyph-sized masks cover stale date and clock pixels
    And neither mask spans its full static date or clock tile
    And the current calendar day and clock remain visible during the drag

  Scenario: Pager movement does not recursively move live page widgets
    Given all home-page snapshots have been prepared while the pager is idle
    And the selected live page remains a descendant of the pager for input routing
    When LVGL applies a raw horizontal pager delta
    Then only the shallow bitmap page surfaces move with the scroller
    And the live page trees stay in a fixed floating input overlay
    And a drag beginning on a live page control can still scroll the pager

  Scenario: Bitmap pager pages avoid layout-manager work during a drag
    Given each moving bitmap page has an explicit fixed horizontal slot position
    And the live input overlay is floating above those bitmap pages
    When the user drags or interrupts a release snap
    Then the pager keeps its native scroll range and adjacent snap points
    And the pager does not use a flex layout to reposition its bitmap pages

  Scenario: A scrollbar-free pager does not refresh every page for its scroll state
    Given the home pager has its scrollbars disabled
    When LVGL enters or leaves its internal scrolled state
    Then the pager removes the unused theme scrollbar-scrolled style
    And the state change does not recursively refresh the bitmap and live page branches  Scenario: Prepared RGB565 snapshots are coherent for hardware composition
    Given an idle home page has been rendered into an immutable RGB565 snapshot
    When P4's PPA composes that snapshot during a pager drag
    Then the snapshot is written back to PSRAM once before it becomes visible
    And the PPA image path can replace the software per-pixel bitmap blend
    And a failed PPA operation remains eligible for LVGL's software fallback

  Scenario: PPA snapshot composition respects a partial output stripe
    Given the pager snapshot is wider and taller than one partial display stripe
    And the PPA receives the snapshot coordinates as its background source
    When it composites the visible crop into a partial RGB565 output buffer
    Then its foreground and output coordinates use the output stripe geometry
    And it does not index the partial output buffer using snapshot coordinates

  Scenario: A release end keeps bitmap pages during an active snap
    Given a home-pager drag is showing its prepared snapshot layers
    And LVGL has started the short release snap toward the selected page
    When LVGL sends the scroll-end event carrying the releasing input device
    Then the native pager hook keeps the snapshot layers visible
    And it does not expose the live page renderer during the snap animation

  Scenario: Snapshot pages stay visible after the release snap completes
    Given a home-pager release snap is showing its prepared snapshot layers
    When LVGL sends the final scroll-end event after the snap animation has completed
    Then the native pager hook selects the live renderer and input layer for the resting page
    And the resting page bitmap remains mounted but renderer-transparent as its drag cache
    And dynamic widgets do not revert to their cached values after the snap

  Scenario: Lua scroll-end work waits for the release snap to finish
    Given a home-pager release snap is showing its prepared snapshot layers
    And the Shell has a Lua scroll-end handler for final page bookkeeping and quota refresh
    When LVGL sends the scroll-end event carrying the releasing input device
    Then the binding does not queue that Lua scroll-end handler during the snap animation
    And it queues the handler only for LVGL's final animation-complete scroll end

  Scenario: A page release continues smoothly to its selected snap point
    Given the user has released a one-page home-pager flick
    When LVGL selects the nearest adjacent snap point
    Then momentum is used only to select that adjacent target
    And the pager eases from the current drag position to that target in a bounded short duration
    And it does not jump directly to the target at release
    And other scrollable widgets keep their existing animation timing

  Scenario: A release snap has enough visible samples to remain continuous
    Given bitmap pager frames can arrive about every 30 milliseconds on the P4
    When the user releases the home pager between two snap points
    Then the interruptible release snap lasts 180 milliseconds
    And it has at least six visual sampling opportunities before it settles

  Scenario: A new drag interrupts an in-flight pager snap
    Given a home-pager snap is moving from a partial drag toward an adjacent page
    When the user presses and moves in either direction before that snap ends
    Then LVGL stops the active snap at its current offset
    And the new drag continues from that offset without waiting for the old snap
    And the next release can select only one adjacent final page

  Scenario: An animated pager command supersedes an in-flight snap
    Given a home-pager release snap is moving its prepared snapshot layers
    When another animated pager command starts before that snap completes
    Then the old animation's completion event does not select a stale live input layer
    And the replacement animation continues moving the prepared snapshot layers
    And only the replacement animation's final completion selects the new input layer

  Scenario: A replacement started before its first frame keeps its snapshot layers
    Given a home-pager release snap has been scheduled but has not drawn its first frame
    When another animated pager command replaces that scheduled snap
    Then the missing completion event from the never-started animation does not strand the snapshot layers
    And the replacement animation marks itself active before its final scroll end can select a live input layer

  Scenario: A page-dot command protects its predecessor before LVGL deletes it
    Given a home-pager release snap is moving its prepared snapshot layers
    When a page-dot command calls animated scroll_to for another page
    Then the binding marks the replacement before LVGL deletes the active scroll animation
    And the deleted predecessor cannot select a stale live input layer or queue Lua scroll-end work
    And only the new scroll_to animation can complete the snapshot transition

  Scenario: A page-dot command can cancel an unstarted snap at its current offset
    Given a home-pager release snap is scheduled but has not drawn its first frame
    When a page-dot command calls animated scroll_to for the pager's current offset
    Then the binding marks the cancellation before LVGL deletes the scheduled animation
    And it selects the current live renderer and input layer when LVGL starts no replacement animation
    And it queues exactly one final Lua scroll-end handler

  Scenario: A released pager always settles on a valid page
    Given the user has dragged the home pager away from its current snap point
    When the user releases the finger
    Then the active snap settles at one valid page position
    And the native scroll-end lifecycle selects the settled live renderer and input layer
    And the resting viewport does not show two home pages at once

  Scenario: A pager flick remains bounded to its adjacent page
    Given a fast home-pager flick has selected an adjacent page
    When the finger is released
    Then the pager uses momentum only to choose the adjacent snap point
    And it does not animate through another page after release

  Scenario: A single missing contact report does not split a drag
    Given the GT911 sampler has observed a pressed finger
    When one poll reports no contact during the drag
    Then it does not emit a release for that single no-contact poll
    And the next valid pressed sample continues the same pager gesture

  Scenario: Two brief missing contact reports do not split a fast drag
    Given the GT911 sampler has observed a pressed finger
    When two consecutive polls report no contact during the drag
    Then it does not emit a release for those brief no-contact polls
    And the next valid pressed sample continues the same pager gesture

  Scenario: Confirmed contact absence releases the pointer safely
    Given the GT911 sampler has observed a pressed finger
    When three consecutive no-contact polls reach the contact grace limit
    Then it emits one released sample without reusing an earlier coordinate

  Scenario: A short swipe survives a busy render frame
    Given the renderer is busy longer than a quick press-move-release gesture
    When the GT911 sampler observes the gesture while LVGL cannot read input
    Then it buffers the press, horizontal movement, and release in order
    And LVGL consumes the buffered press before the release when it next runs
    And the pager receives the gesture instead of treating it as no input

  Scenario: A newer short swipe replaces an unread completed swipe
    Given LVGL has not consumed a completed pager swipe while rendering
    When the GT911 sampler observes a newer pager press
    Then it discards the completed unread swipe
    And LVGL receives the newer press, movement, and release in order
    And one delayed render pass cannot replay two page advances

  Scenario: A rapid reverse swipe terminates its stale active gesture
    Given LVGL has consumed a pager press but not its matching release
    And the GT911 queue still contains stale movement and that release
    When the GT911 sampler observes the next physical pager press
    Then the queue retains exactly the outstanding release boundary
    And it discards stale movement before the new press
    And LVGL cannot apply the stale movement as an extra page advance

  Scenario: Buffered movement is paced with visible frames
    Given the GT911 sampler has buffered a press, movement, and release
    When LVGL starts consuming the buffered gesture
    Then it consumes at most one semantic input sample per indev timer pass
    And it does not replay several historical movement positions before the next rendered frame

  Scenario: Polling keeps its configured sampling cadence
    Given the GT911 has no usable interrupt line on this board
    When a poll spends time reading one touch sample
    Then the next poll is scheduled from the previous sampling deadline
    And touch-read duration is not added to every sampling interval

  Scenario: One failed touch-bus read does not split a drag
    Given the GT911 sampler has observed a pressed finger
    When one touch-controller transaction fails during the drag
    Then it does not emit a release for that single failed transaction
    And the next valid pressed sample continues the same pager gesture

  Scenario: Sustained touch-bus failure releases safely
    Given the GT911 sampler has observed a pressed finger
    When consecutive touch-controller transactions reach the error grace limit
    Then it emits one released sample without reusing an earlier coordinate

  Scenario: A full-width pager uses the triple-full display pipeline
    Given the MIPI panel has enough PSRAM for three RGB565 framebuffers
    And the home pager moves prepared snapshots across most of the viewport during a drag
    When the Shell starts LVGL for the launcher
    Then it provisions the three framebuffers required by TRIPLE_FULL
    And it uses the adapter full-frame pipeline instead of repeatedly composing partial stripes

  Scenario: The P4 pager build favors PSRAM-backed frame throughput
    Given the MIPI pager must move a near-full-screen RGB565 frame while dragging
    And the board uses PSRAM-backed DPI framebuffers
    When the production firmware is configured for the P4 display path
    Then it uses the performance compiler profile
    And it enables the P4 256 KiB L2 cache with 128-byte cache lines
    And it aligns LVGL draw buffers to those 128-byte cache lines
    And it keeps instruction execution from PSRAM enabled

  Scenario: A PPA-ineligible snapshot layer falls back without aborting
    Given the P4 PPA requires 128-byte output-buffer alignment
    And a snapshot layer can be backed by a buffer outside that alignment
    When the adapter or native LVGL PPA unit considers accelerating a snapshot fill or blend
    Then it does not let the PPA unit claim an ineligible output layer
    And LVGL's software draw unit renders that operation
    And it does not abort the UI task because PPA rejects the buffer

  Scenario: Direct paging does not block input while a frame is scanned
    Given the MIPI panel provides two full RGB565 framebuffers
    And the home pager is using LVGL direct rendering
    When LVGL submits the last dirty area of a pager frame
    Then the LVGL task returns without synchronously waiting for VSYNC
    And the panel refresh-complete callback marks the framebuffer reusable

  Scenario: An idle DPI scan does not release an LVGL framebuffer
    Given the direct renderer has no submitted LVGL framebuffer pending
    When the DPI panel reports a routine refresh-complete event
    Then the Shell does not call LVGL flush-ready for that idle scan

  Scenario: A completed render does not add an extra input-delay period
    Given an LVGL render pass has already consumed more than one Shell period
    When the LVGL task finishes that render pass
    Then its next run is scheduled from the fixed task cadence
    And it does not sleep for another full task period before reading touch

  Scenario: A new touch sample wakes the Shell task promptly
    Given the LVGL task is sleeping until its next periodic deadline
    When the GT911 sampler queues a semantic press, move, or release sample
    Then it wakes the LVGL task without calling an LVGL API from the sampler
    And the input sample is eligible for the next Shell handler pass immediately

  Scenario: A queued touch sample arms one native input-timer pass
    Given the GT911 sampler has queued a fresh semantic touch sample
    And the pointer indev is idle between gestures
    When the awakened Shell task enters LVGL under its normal lock
    Then it marks the pointer read timer ready before its normal timer pass
    And that timer consumes at most one semantic input sample before rendering
    And the Shell does not manually read the indev alongside the native timer

  Scenario: The adapter worker drains buffered touch input
    Given the MIPI home pager is driven by esp_lvgl_adapter
    When the GT911 sampler queues a fresh semantic touch sample
    Then an LVGL timer owned by the adapter arms the pointer read timer
    And it drains the pager trace after the adapter handler pass
    And the sampler does not call an LVGL API directly

  Scenario: An adapter pager trace separates renderer work from input backlog
    Given the MIPI home pager is driven by esp_lvgl_adapter
    And a pager scroll is active
    When the adapter worker emits LVGL refresh, render, and flush events
    Then the trace records the longest refresh, render, flush, and flush-wait phase
    And the display event callback only timestamps the events

  Scenario: An intentional motion that does not start paging is observable
    Given the GT911 sampler has observed a press, move, and release
    When LVGL consumes that complete touch sequence without starting a pager scroll
    Then one end-to-end trace records result no-scroll and the consumed samples
    And no trace is emitted for each individual move sample  Scenario: A cached quota page reflects the latest host push
    Given the host has pushed a new subscription snapshot
    When the launcher is idle
    Then the page-two bitmap snapshot is refreshed with the new values
    And a gesture never rebuilds the page bitmap
