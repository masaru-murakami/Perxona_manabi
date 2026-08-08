# Starter Demo

This is the smallest complete Presenter flow in the Express sample. It loads catalog resources, selects configurable
defaults, initializes `<sv-presenter>`, previews a motion, speaks text, and presents Motion Markup.

Run the server from `samples/express/` with Node 22:

```bash
cp .env.example .env
npm install
npm start
```

Open <http://localhost:8083/demos/starter/>. Set `DEMO_DEFAULT_AVATAR_ID`, `DEMO_DEFAULT_SCENE_ID`,
`DEMO_DEFAULT_VOICE_ID`, and `DEMO_DEFAULT_MOTION_ID` in `.env` to use resources from your account. The page also lets
you replace each selection from the live catalog.

The core sequence is:

```js
await presenter.resumeAudioPlayback();
const { connect_token } = await fetch("/api/connect-token").then((response) =>
  response.json(),
);
await presenter.initialize(connect_token, {
  avatarId,
  sceneId,
  voiceId,
});
await presenter.present("Hello [MOTION motion-id:1]");
```

`playMotion()` receives a string motion ID: `presenter.playMotion("motion-id")`. It does not receive an object. Mock
mode loads the catalog but cannot launch the real Presenter engine.
