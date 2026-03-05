import onnxruntime as ort
from transformers import AutoTokenizer
import numpy as np

ONNX_DIR = "models"
MODEL_PATH = f"{ONNX_DIR}/model.onnx"

tokenizer = AutoTokenizer.from_pretrained(ONNX_DIR)
sess = ort.InferenceSession(MODEL_PATH)

# Debug: print ONNX expected inputs
print("ONNX inputs:", [(i.name, i.shape, i.type) for i in sess.get_inputs()])

text = "It's joever for me"
token_outputs = tokenizer(text, return_tensors="np", padding='max_length', truncation=True, max_length=128)

# Ensure keys/dtypes match ONNX expected inputs
ort_inputs = {}
# reference shape/dtype from tokenizer outputs
ref_arr = next(iter(token_outputs.values()))
batch_size, seq_len = ref_arr.shape
for inp in sess.get_inputs():
    name = inp.name
    if name in token_outputs:
        arr = np.asarray(token_outputs[name])
    else:
        # create a placeholder (common missing: token_type_ids)
        arr = np.zeros((batch_size, seq_len), dtype=ref_arr.dtype)
    t = str(inp.type).lower()
    if 'int64' in t:
        arr = arr.astype(np.int64)
    elif 'int32' in t:
        arr = arr.astype(np.int32)
    elif 'float' in t:
        arr = arr.astype(np.float32)
    ort.inputs[name] = arr

outputs = sess.run(None, ort.inputs)
print("outputs shapes:", [o.shape for o in outputs])
