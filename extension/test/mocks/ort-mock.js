class Tensor {
  constructor(dtype, data, shape) {
    this.data = data;
    this.dims = shape;
  }
}

class InferenceSessionMock {
  constructor(modelUrl) {
    this.modelUrl = modelUrl;
  }
  async run(inputs) {
    // return deterministic logits for testing
    // produce 4-class logits (Anxiety, Depression, Normal, Suicidal)
    const logits = new Float32Array([1.0, 0.5, 0.2, 2.0]);
    return { logits: { data: logits } };
  }
}

module.exports = {
  env: { wasm: {} },
  InferenceSession: {
    create: async (modelUrl, opts) => new InferenceSessionMock(modelUrl),
  },
  Tensor,
};
