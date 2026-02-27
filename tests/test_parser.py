"""
Tests for Cosmos Reason 2 chain-of-thought parser.

The parser handles multiple output formats from Cosmos Reason 2,
including edge cases where the model uses <think> as both opening
and closing tag.

Run: python -m pytest tests/ -v
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from cosmos_reason2 import parse_cosmos_response


class TestParseCosmosResponse:
    """Test the chain-of-thought parser."""

    def test_standard_think_answer(self):
        """Standard format: <think>...</think> answer"""
        raw = "<think>The ball is heading toward the boundary.</think>Boundary 4 — cover drive."
        thinking, answer = parse_cosmos_response(raw)
        assert thinking == "The ball is heading toward the boundary."
        assert answer == "Boundary 4 — cover drive."

    def test_think_with_answer_tags(self):
        """Format: <think>...</think><answer>...</answer>"""
        raw = "<think>Checking line and length.</think><answer>Dot ball, good length delivery.</answer>"
        thinking, answer = parse_cosmos_response(raw)
        assert thinking == "Checking line and length."
        assert answer == "Dot ball, good length delivery."

    def test_no_think_tags(self):
        """No think tags — entire response is the answer."""
        raw = "The serve landed in. First serve ace."
        thinking, answer = parse_cosmos_response(raw)
        assert thinking == ""
        assert answer == "The serve landed in. First serve ace."

    def test_empty_think_block(self):
        """Empty think block."""
        raw = "<think></think>Quick answer here."
        thinking, answer = parse_cosmos_response(raw)
        assert thinking == ""
        assert answer == "Quick answer here."

    def test_multiline_thinking(self):
        """Multi-line reasoning inside think tags."""
        raw = """<think>
Step 1: The ball is in the air.
Step 2: Trajectory suggests boundary.
Step 3: No fielder in position.
</think>
Boundary 4 confirmed."""
        thinking, answer = parse_cosmos_response(raw)
        assert "Step 1" in thinking
        assert "Step 3" in thinking
        assert "Boundary 4 confirmed." in answer

    def test_empty_response(self):
        """Empty string input."""
        thinking, answer = parse_cosmos_response("")
        assert thinking == ""
        assert answer == ""

    def test_think_only_no_answer(self):
        """Only thinking, no answer after close tag."""
        raw = "<think>Analyzing the frame carefully.</think>"
        thinking, answer = parse_cosmos_response(raw)
        assert thinking == "Analyzing the frame carefully."
        assert answer == ""

    def test_json_in_answer(self):
        """JSON object in the answer portion."""
        raw = '<think>Ball crossing boundary.</think>{"event": "boundary_4", "confidence": 0.92}'
        thinking, answer = parse_cosmos_response(raw)
        assert thinking == "Ball crossing boundary."
        assert '"boundary_4"' in answer

    def test_nested_angle_brackets_in_thinking(self):
        """Angle brackets inside thinking (e.g., comparisons)."""
        raw = "<think>Speed > 140 km/h. Angle < 30 degrees.</think>Fast serve, likely ace."
        thinking, answer = parse_cosmos_response(raw)
        assert "140 km/h" in thinking
        assert "Fast serve" in answer


class TestParseCosmosResponseEdgeCases:
    """Edge cases specific to Cosmos Reason 2-8B quirks."""

    def test_whitespace_between_tags(self):
        """Whitespace between closing think and answer."""
        raw = "<think>Reasoning here.</think>\n\n\nThe answer is boundary 4."
        thinking, answer = parse_cosmos_response(raw)
        assert thinking == "Reasoning here."
        assert answer == "The answer is boundary 4."

    def test_answer_with_markdown(self):
        """Answer contains markdown formatting."""
        raw = "<think>Analysis complete.</think>**Serve Analysis**\n\n- Shot type: Flat serve\n- Speed: ~180 km/h"
        thinking, answer = parse_cosmos_response(raw)
        assert "Analysis complete." in thinking
        assert "**Serve Analysis**" in answer
        assert "180 km/h" in answer
