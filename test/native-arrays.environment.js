const { TestEnvironment } = require('jest-environment-node');

/**
 * Jest gives each test file its own copies of the built-in classes. A
 * native module hands back arrays made by Node's real ones, so ONNX
 * Runtime's `data instanceof Float32Array` fails inside a test although it
 * holds in the running service. This environment gives the test file
 * Node's own typed-array classes, so the real models can run under Jest.
 *
 * Opt in per file: `@jest-environment <path to this file>`.
 */
class NativeArraysEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of [
      'ArrayBuffer',
      'Float32Array',
      'Float64Array',
      'Int8Array',
      'Int16Array',
      'Int32Array',
      'Uint8Array',
      'Uint16Array',
      'Uint32Array',
      'BigInt64Array',
      'BigUint64Array',
    ]) {
      this.global[name] = global[name];
    }
  }
}

module.exports = NativeArraysEnvironment;
