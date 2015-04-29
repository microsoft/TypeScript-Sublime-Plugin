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

def decode(json_str):
    return json.loads(json_str)