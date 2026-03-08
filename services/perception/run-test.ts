import { readFileSync } from "node:fs"
import { processScene } from "./src/index"

async function main() {
  const imagePath = process.argv[2]
  if (!imagePath) {
    console.error("Usage: npx tsx run-test.ts <path-to-image.jpg>")
    process.exit(1)
  }

  const imageBase64 = readFileSync(imagePath).toString("base64")

  const response = await processScene({
    scene_id: "test_001",
    timestamp: Date.now(),
    frame_image_base64: imageBase64,
    hints: { likely_environment: "living_room" },
  })

  console.log(JSON.stringify(response, null, 2))
}

main()
