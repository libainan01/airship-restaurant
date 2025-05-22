class_name MouseClickSpace
extends Polygon2D
func _create_polygon_by_point (points:PackedVector2Array) -> Polygon2D:
	polygon = points
	return self
