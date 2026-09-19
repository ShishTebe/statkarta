import Foundation
import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
  guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["ru-RU"]
  req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  var items: [(y: CGFloat, h: CGFloat, x: CGFloat, s: String)] = []
  for o in req.results ?? [] { if let t = o.topCandidates(1).first { let b = o.boundingBox; items.append((b.midY, b.height, b.minX, t.string)) } }
  items.sort { $0.y > $1.y }
  var lines: [[(y: CGFloat, h: CGFloat, x: CGFloat, s: String)]] = []
  for it in items {
    if var last = lines.last, let ref = last.first, abs(ref.y - it.y) < min(ref.h, it.h) * 0.6 {
      last.append(it); lines[lines.count - 1] = last
    } else { lines.append([it]) }
  }
  let out = lines.map { $0.sorted { $0.x < $1.x }.map { $0.s }.joined(separator: " ") }.joined(separator: "\n") + "\n"
  try? out.write(toFile: (path as NSString).deletingPathExtension + ".v.txt", atomically: true, encoding: .utf8)
}
