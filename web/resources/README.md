# Capacitor app resources

- `icon.png` is copied from `桌宠蓝牙控制_app_icon_256x256.png`.
- `splash.png` is copied from `968f97ac-25a5-4676-a522-d304fc2ae313.png` because it is the portrait startup-screen-sized image.

If `capacitor-assets` asks for a larger icon source, replace `icon.png` with one of the 1254x1254 square PNG files in `web/`. After `npm install` and `npm run android:add`, run `npm run assets:generate` again whenever either file changes.