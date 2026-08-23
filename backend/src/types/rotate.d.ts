declare module 'winston-daily-rotate-file' {
  import { TransportStream } from 'winston';
  interface DailyRotateFileOptions {
    dirname?: string;
    filename?: string;
    datePattern?: string;
    maxFiles?: string | number;
    zippedArchive?: boolean;
    frequency?: string;
    format?: unknown;
  }
  class DailyRotateFile extends TransportStream {
    constructor(options?: DailyRotateFileOptions);
  }
  export default DailyRotateFile;
}
