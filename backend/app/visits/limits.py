"""The numbers of the visits module (spec sections 14 and 15)."""

MAX_PHOTO_BYTES = 600 * 1024  # one photo, after the phone has resized and compressed it
PHOTO_SIDE = 1280  # longest side the phone scales a photo to
PHOTO_RETENTION_DAYS = 183  # about 6 months; the visit record itself stays
MIN_FREE_BYTES = 1024**3  # uploads stop when the photo folder's disk has less than this free
ROOM_NAME_MAX = 60
REASON_MAX = 200  # a room skip or a correction
CHECKIN_PEOPLE_MAX = 100  # same bound as the people of an Agenda item
