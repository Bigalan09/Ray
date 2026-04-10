from config import load_yaml


def test_default_model_is_gpt_5_nano():
    models_config = load_yaml("models.yaml")
    assert models_config["default_model"] == "gpt-5-nano"
