/**
 * Side-effect module: installs DOMMatrix / Path2D / ImageData polyfills
 * required by pdfjs-dist top-level initialisation in Node / bun environments.
 *
 * Import this module BEFORE pdfjs-dist to guarantee polyfills are in place
 * when pdfjs-dist executes its module-level code (e.g. SCALE_MATRIX = new DOMMatrix).
 */

const globalScope = globalThis as Record<string, unknown>;

if (typeof globalScope.DOMMatrix !== "function") {
  class SimpleDOMMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(init?: ArrayLike<number>) {
      if (init && init.length >= 6) {
        this.a = Number(init[0]) || 1;
        this.b = Number(init[1]) || 0;
        this.c = Number(init[2]) || 0;
        this.d = Number(init[3]) || 1;
        this.e = Number(init[4]) || 0;
        this.f = Number(init[5]) || 0;
      }
    }

    multiplySelf(): this {
      return this;
    }

    preMultiplySelf(): this {
      return this;
    }

    translate(): this {
      return this;
    }

    scale(): this {
      return this;
    }

    invertSelf(): this {
      return this;
    }
  }

  globalScope.DOMMatrix = SimpleDOMMatrix;
}

if (typeof globalScope.Path2D !== "function") {
  class SimplePath2D {
    addPath(): void {}
    closePath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    bezierCurveTo(): void {}
    quadraticCurveTo(): void {}
    arc(): void {}
    rect(): void {}
  }

  globalScope.Path2D = SimplePath2D;
}

if (typeof globalScope.ImageData !== "function") {
  class SimpleImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;

    constructor(dataOrWidth: Uint8ClampedArray | number, width?: number, height?: number) {
      if (typeof dataOrWidth === "number") {
        this.width = dataOrWidth;
        this.height = width ?? dataOrWidth;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
        return;
      }

      this.data = dataOrWidth;
      this.width = width ?? 0;
      this.height = height ?? 0;
    }
  }

  globalScope.ImageData = SimpleImageData;
}
