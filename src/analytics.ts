import * as fs from "node:fs";
import * as path from "node:path";

export interface UpdateCheckEvent {
  ts: string;
  product: string;
  ip: string;
  target: string;
  arch: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  userAgent: string;
  cfuId: string;
  checkReason: string;
}

export class AnalyticsLogger {
  /** product -> { currentDate, stream } */
  private streams = new Map<
    string,
    { currentDate: string; stream: fs.WriteStream }
  >();

  constructor(private logDir: string) {}

  log(entry: UpdateCheckEvent): void {
    const date = new Date().toISOString().slice(0, 10);
    const productDir = path.join(this.logDir, entry.product);

    let state = this.streams.get(entry.product);
    if (!state || state.currentDate !== date) {
      state?.stream.end();
      fs.mkdirSync(productDir, { recursive: true });
      const filePath = path.join(productDir, `${date}.ndjson`);
      const stream = fs.createWriteStream(filePath, { flags: "a" });
      state = { currentDate: date, stream };
      this.streams.set(entry.product, state);
    }
    state.stream.write(`${JSON.stringify(entry)}\n`);
  }

  close(): void {
    for (const { stream } of this.streams.values()) {
      stream.end();
    }
    this.streams.clear();
  }
}
