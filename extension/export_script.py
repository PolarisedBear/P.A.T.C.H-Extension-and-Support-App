from transformers import AutoTokenizer, AutoModelForSequenceClassification
from optimum.onnxruntime import ORTModelForSequenceClassification
from optimum.onnxruntime.configuration import OptimizationConfig

MODEL_ID = "ourafla/mental-health-bert-finetuned"  # or local path
ONNX_DIR = "models"

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
hf_model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID)

# Export to ONNX
ort_model = ORTModelForSequenceClassification.from_pretrained(
    MODEL_ID,
    export=True
)

ort_model.save_pretrained(ONNX_DIR)
tokenizer.save_pretrained(ONNX_DIR)
