
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
        if key in cls.listener_dict.keys():
            for handler in cls.listener_dict[key]:
                handler(*args)

    @classmethod
    def run_listener_with_return(cls, key, *args):
        """Return the first non-None result, otherwise return None"""
        if key in cls.listener_dict.keys():
            res = cls.listener_dict[key][0](*args)
            if res is not None:
                return res
        return None
