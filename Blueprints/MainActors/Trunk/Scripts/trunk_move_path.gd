extends Path2D

func _init() -> void:
	var _screen_size = DisplayServer.screen_get_size()
	curve.add_point(Vector2(0,0))
	curve.add_point(Vector2(_screen_size.x,0))
	curve.add_point(Vector2(_screen_size))
	curve.add_point(Vector2(0,_screen_size.y))
