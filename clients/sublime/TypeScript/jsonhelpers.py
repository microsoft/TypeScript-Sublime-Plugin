import json

class ObjectJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, object):
            # filter out properties with None value
            return dict((key, value) for (key, value) in obj.__dict__.items() if not value is None)
        return json.JSONEncoder.default(self, obj)


def encode(obj):
    jsonStr = json.dumps(obj, cls=ObjectJSONEncoder)
    return jsonStr


def decode(type, jsonStr):
    jsonDict = json.loads(jsonStr)
    return fromDict(type, jsonDict)


def fromDict(type, value):
    if isinstance(value, list):
        return [fromDict(type, i) for i in value]
    elif isinstance(value, dict):
        fromDict_op = getattr(type, "fromDict", None)
        if callable(fromDict_op):
            return type.fromDict(**value)
        else:
            return type(**value)
    else:
        return value