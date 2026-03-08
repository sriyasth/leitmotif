import { processScene } from "./src/index"

async function main() {
  const response = await processScene({
    scene_id: "test_mock_001",
    timestamp: Date.now(),
    object_candidates: [
      { label: "couch", confidence: 0.92, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
      { label: "lamp", confidence: 0.85, bounding_box: { x: 0.7, y: 0.1, w: 0.1, h: 0.4 } },
      { label: "cat", confidence: 0.70, bounding_box: { x: 0.3, y: 0.6, w: 0.1, h: 0.1 } },
    ],
    hints: { likely_environment: "living_room" },
  })

  console.log(JSON.stringify(response, null, 2))
}

main()
