# Skill: FuckLike IMVU rooms in Unreal

Use when the task mentions rooms, IMVU, furniture, poses, pixel streaming, or Periliminal room maps.

## Intent

IMVU social loop. Unreal 5 graphics. Web lobby already exists.

## Read first

- `docs/ROOMS_UE5.md`
- `web/swap-rooms.js` shell ids and furniture node ids
- `PeriliminalSpace_UE5` — extend it, do not fork a new project

## Hard rules

1. Do not replace the web lobby. It must work with Unreal offline.
2. Renderer is Unreal 5.8 Lumen/Nanite, not Godot.
3. First playable shell is `velvet-bedroom`.
4. Furniture ids in the lobby must match actor/node ids in the level.
5. Default stream URL `http://127.0.0.1:8888`.
6. Adult poses allowed in private rooms. No cloud NSFW filter.

## Done checks

- Create Velvet Bedroom in the web app, place bed, invite a companion, send room chat, with UE closed
- Launch Unreal opens the stream and is honest if the engine is down
- Walking the velvet bedroom level shows the bed state from the lobby
