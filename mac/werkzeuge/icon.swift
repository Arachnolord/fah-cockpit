// (c) 2026 Fabian Hammer. Zeichnet das App-Symbol von FAH-Cockpit (Knotenpunkte wie im Wissensnetz) als PNG.
// Aufruf: swift werkzeuge/icon.swift <ausgabe.png> <pixel>
import AppKit
let args = CommandLine.arguments
let datei = args[1], n = CGFloat(Double(args[2]) ?? 1024)
let bild = NSImage(size: NSSize(width: n, height: n))
bild.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext
let rand = n * 0.1, flaeche = CGRect(x: rand, y: rand, width: n - 2 * rand, height: n - 2 * rand)
let form = NSBezierPath(roundedRect: flaeche, xRadius: n * 0.18, yRadius: n * 0.18)
NSGradient(starting: NSColor(red: 0.11, green: 0.12, blue: 0.13, alpha: 1), ending: NSColor(red: 0.05, green: 0.055, blue: 0.06, alpha: 1))!.draw(in: form, angle: -90)
NSColor(white: 1, alpha: 0.08).setStroke(); form.lineWidth = n * 0.006; form.stroke()
let gruen = NSColor(red: 0.56, green: 0.82, blue: 0.42, alpha: 1)
func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: flaeche.minX + x * flaeche.width, y: flaeche.minY + y * flaeche.height) }
let mitte = p(0.42, 0.5)
let aussen: [(CGPoint, CGFloat, NSColor)] = [
  (p(0.74, 0.76), 0.075, gruen), (p(0.76, 0.28), 0.075, gruen), (p(0.2, 0.78), 0.05, NSColor(red: 0.44, green: 0.66, blue: 1, alpha: 1)),
  (p(0.22, 0.24), 0.05, NSColor(red: 0.72, green: 0.55, blue: 1, alpha: 1)), (p(0.6, 0.12), 0.035, NSColor(red: 0.95, green: 0.76, blue: 0.31, alpha: 1)),
  (p(0.88, 0.52), 0.035, NSColor(red: 0.95, green: 0.76, blue: 0.31, alpha: 1)),
]
ctx.setLineCap(.round)
for (q, _, _) in aussen { ctx.setStrokeColor(gruen.withAlphaComponent(0.55).cgColor); ctx.setLineWidth(n * 0.022); ctx.move(to: mitte); ctx.addLine(to: q); ctx.strokePath() }
ctx.setStrokeColor(NSColor(white: 1, alpha: 0.12).cgColor); ctx.setLineWidth(n * 0.012)
ctx.move(to: aussen[0].0); ctx.addLine(to: aussen[5].0); ctx.addLine(to: aussen[1].0); ctx.strokePath()
for (q, r, f) in aussen { f.setFill(); NSBezierPath(ovalIn: CGRect(x: q.x - r * n, y: q.y - r * n, width: 2 * r * n, height: 2 * r * n)).fill() }
gruen.setFill(); let rm = n * 0.11; NSBezierPath(ovalIn: CGRect(x: mitte.x - rm, y: mitte.y - rm, width: 2 * rm, height: 2 * rm)).fill()
NSColor(white: 1, alpha: 0.9).setFill(); let ri = n * 0.04; NSBezierPath(ovalIn: CGRect(x: mitte.x - ri, y: mitte.y - ri, width: 2 * ri, height: 2 * ri)).fill()
bild.unlockFocus()
let rep = NSBitmapImageRep(data: bild.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: datei))
