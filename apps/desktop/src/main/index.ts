import { app } from "electron";
import { AppLifecycle } from "./app-lifecycle";

const lifecycle = new AppLifecycle();

void lifecycle.start().catch((error: unknown) => {
  console.error("[AppLifecycle] Fatal startup failure", error);
  app.exit(1);
});
