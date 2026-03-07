import { classifyVibe } from "./src/vibe-classifier"

function main() {
  const response = classifyVibe("test_mock_001", Date.now(), {
    vibe: "calm_familiar",
    confidence: 0.87,
    descriptors: ["indoor", "stable", "low_activity"],
  })
  console.log(JSON.stringify(response, null, 2))
}

main()
