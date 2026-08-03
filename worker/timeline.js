const captureTimelineName = /^c-(\d{1,13})-/;

export function timelineForObject(object) {
  const filename = object.key.split('/').pop() || '';
  const match = captureTimelineName.exec(filename);
  const captureTime = match ? Number(match[1]) : NaN;

  return {
    time: Number.isSafeInteger(captureTime) ? captureTime : object.uploaded.getTime(),
    id: object.key
  };
}

export function compareTimeline(leftObject, rightObject) {
  const left = timelineForObject(leftObject);
  const right = timelineForObject(rightObject);

  return left.time - right.time || left.id.localeCompare(right.id);
}
