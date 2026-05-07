export const notifyAdmins = (req, event, data = {}) => {
  const io = req.app.get('io');
  if (io) {
    // If locationId isn't in data, try to extract it from req if possible
    const locationId = data.locationId || req.headers['x-location-id'] || req.user?.locationId;
    io.to('admin_room').emit(event, { ...data, locationId });
  }
};
