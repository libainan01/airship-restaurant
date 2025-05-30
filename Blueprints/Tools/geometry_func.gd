class_name GeometryFunc
extends Node

static func creat_square(center: Vector2,size : float)->PackedVector2Array:
	var points = PackedVector2Array()
	points.append(center + Vector2(-size/2,-size/2))
	points.append(center + Vector2(size/2,-size/2))
	points.append(center + Vector2(size/2,size/2))
	points.append(center + Vector2(-size/2,size/2))
	return points
