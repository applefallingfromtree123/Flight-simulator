// Geometry compression for the web aircraft: EXT_meshopt_compression (+ KHR_mesh_quantization), in place.
// Usage: node tools/fgconv/compress.mjs <file.gltf>...   (images and their URIs are left untouched)
// Node names, materials and the scene graph are kept, so the web scene still finds Exterior/Pose_*/Spin_*/Interior.
// Quantization folds a scale/offset into each mesh node's transform: the web scene composes its own placement
// with the node's original matrix (ModelNode.originalMatrix), so that is fine.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const before = doc.getRoot().listBuffers().length;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  // one buffer, written next to the .gltf with the original name
  const buffers = doc.getRoot().listBuffers();
  const main = buffers.find(b => !b.getExtension('EXT_meshopt_compression')) ?? buffers[0];
  const keep = doc.getRoot().listBuffers()[0].getURI() || 'model.bin';
  main.setURI(keep);
  await io.write(file, doc);
  console.log(`compressed ${file} (${before} buffer)`);
}
