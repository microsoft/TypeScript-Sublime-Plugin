import sublime, sublime_plugin

class StaticRegion:
    """Region that will not change as buffer is modified"""
    def __init__(self, a, b):
        self.a = a
        self.b = b

    def toRegion(self):
        return sublime.Region(self.a, self.b)

    def begin(self):
        return self.a

    def empty(self):
        return self.a == self.b

def copy_region(r):
    """Copy a region (this is needed because the original region may change)"""
    return sublime.Region(r.begin(), r.end())

def copy_regions(regions):
    """Copy a list of regions"""
    return [copy_region(r) for r in regions]

def region_to_static_region(r):
    """Copy a region into a static region"""
    return StaticRegion(r.begin(), r.end())

def static_regions_to_regions(static_regions):
    """Convert a list of static regions to ordinary regions"""
    return [sr.toRegion() for sr in static_regions]

def regions_to_static_regions(regions):
    """Copy a list of regions into a list of static regions"""
    return [region_to_static_region(r) for r in regions]

def decrease_empty_regions(empty_regions, amount):
    """
    From a list of empty regions, make a list of regions whose begin() value is
    one before the begin() value of the corresponding input (for left_delete)
    """
    return [sublime.Region(r.begin() - amount, r.end() - amount) for r in empty_regions]

def decrease_locs_to_regions(locs, amount):
    """Move the given locations by amount, and then return the corresponding regions"""
    return [sublime.Region(loc - amount, loc - amount) for loc in locs]

def extract_line_offset(line_offset):
    """
    Destructure line and offset tuple from LineOffset object
    convert 1-based line, offset to zero-based line, offset
    ``lineOffset`` LineOffset object
    """
    if isinstance(line_offset, dict):
        line = line_offset["line"] - 1
        offset = line_offset["offset"] - 1
    else:
        line = line_offset.line - 1
        offset = line_offset.offset - 1
    return (line, offset)
