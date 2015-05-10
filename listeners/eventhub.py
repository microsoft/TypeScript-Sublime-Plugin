
class EventHub:
    listener_dict = dict()

    @classmethod
    def subscribe(cls, key, listener):
        if key in cls.listener_dict.keys():
            cls.listener_dict[key].append(listener)
        else:
            cls.listener_dict[key] = [listener]

    @classmethod
    def run_listeners(cls, key, *args):
        for handler in cls.listener_dict[key]:
            handler(*args)

