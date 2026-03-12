from optimum.onnxruntime import ORTModelForSequenceClassification, ORTOptimizer
from optimum.onnxruntime.configuration import OptimizationConfig

ONNX_DIR = "models"

ort_model = ORTModelForSequenceClassification.from_pretrained(ONNX_DIR)
optimizer = ORTOptimizer.from_pretrained(ort_model)

optimization_config = OptimizationConfig(
    optimization_level=99,  # enable transformer fusions
)

optimizer.optimize(
    save_dir=ONNX_DIR,
    optimization_config=optimization_config
)
