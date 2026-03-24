export class Version {
  private static readonly LAME_URL = "http://www.mp3dev.org/";
  private static readonly LAME_MAJOR_VERSION = 3;
  private static readonly LAME_MINOR_VERSION = 98;
  private static readonly LAME_PATCH_VERSION = 4;
  private static readonly PSY_MAJOR_VERSION = 0;
  private static readonly PSY_MINOR_VERSION = 93;

  getLameVersion(): string {
    return `${Version.LAME_MAJOR_VERSION}.${Version.LAME_MINOR_VERSION}.${Version.LAME_PATCH_VERSION}`;
  }

  getLameShortVersion(): string {
    return `${Version.LAME_MAJOR_VERSION}.${Version.LAME_MINOR_VERSION}.${Version.LAME_PATCH_VERSION}`;
  }

  getLameVeryShortVersion(): string {
    return `LAME${Version.LAME_MAJOR_VERSION}.${Version.LAME_MINOR_VERSION}r`;
  }

  getPsyVersion(): string {
    return `${Version.PSY_MAJOR_VERSION}.${Version.PSY_MINOR_VERSION}`;
  }

  getLameOsBitness(): string {
    return "32bit";
  }
}
