# FuckLike rooms — IMVU loop, Unreal graphics

Owner decision, 2026-09-25: rooms are IMVU-type social spaces, rendered at Unreal quality. Not a Godot lookalike. Not a flat chat box with a 3D sticker.

## What "IMVU-type" means here

The social loop, not the 2004 art style.

- Room shells you own (bedroom, club, dungeon, penthouse, bath, motel, rooftop, dressing room)
- Public vs private
- Occupancy cap
- Furniture / action nodes you place (bed, booth, mirror, pole-equivalent nodes, pool edge)
- Invite a companion (later: invite another user)
- Poses on nodes: stand, sit, lean, dance, and adult poses when NSFW is on
- Room chat that belongs to the room, not the 1:1 companion thread
- Boot someone
- Room card (name, who's inside, visibility)

Web lobby for this already lives in `web/index.html` + `web/swap-rooms.js`. It persists in `localStorage` key `fucklike_rooms_v1`. It must keep working with Unreal offline.

## Graphics path

Renderer: **Unreal Engine 5.8 project `PeriliminalSpace_UE5`** (`joeholloway445-maker/PeriliminalSpace_UE5`).

- Lumen + Nanite are the quality bar
- Pixel Streaming (or a local packaged client) is how the web stage becomes the actual room
- Default stream URL: `http://127.0.0.1:8888` (overridable in the Rooms panel)
- Launch hint already in the UI: `Launch_Periliminal_Game.bat`
- Godot (`FuckLike-Godot-PeriHuman`) stays an optional lightweight client. It is **not** the graphics path for rooms.

Do not build a second Unreal project. Extend Periliminal.

## Antigravity / next engine work

In `PeriliminalSpace_UE5`, add a FuckLike room map set:

1. One persistent level per shell id in `web/swap-rooms.js` (`velvet-bedroom`, `afterhours-club`, `mirror-dungeon`, `glass-penthouse`, `temple-bath`, `neon-motel`, `rooftop`, `dressing-room`).
2. Action nodes as placed actors matching the furniture ids.
3. A localhost JSON bridge that reads the active room from the web lobby (or a tiny local file/websocket the lobby can POST). Minimum: room id, visibility, placed nodes, occupant ids, pose ids.
4. Pixel Streaming enabled on the packaged or editor game so the Rooms panel iframe/window is the real render.
5. Avatars can start as mannequins. Face-swapped portraits from `local-swap` are a later texture/MetaHuman source, not a blocker.

Adult content is allowed in private rooms. No cloud NSFW classifier on room poses.

## Done when

- Web lobby creates, enters, furnishes, invites, poses, and chats with Unreal down.
- Launch Unreal opens the stream URL and tells the truth if the engine is not running.
- At least one shell (`velvet-bedroom`) exists as a real UE5 level you can walk.
- Placing the bed node in the lobby moves or reveals the bed in that level.
