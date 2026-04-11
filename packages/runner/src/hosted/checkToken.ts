import { loadDeviceToken } from "./deviceTokenStore";

loadDeviceToken().then((token) => {
  process.exit(token ? 0 : 1);
}).catch(() => {
  process.exit(1);
});
