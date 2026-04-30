function getBuiltInSkeletonReferenceImages() {
  return String(process.env.SKELETON_REFERENCE_IMAGE_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

module.exports = { getBuiltInSkeletonReferenceImages };
