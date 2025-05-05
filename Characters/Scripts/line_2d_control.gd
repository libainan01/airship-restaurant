extends Line2D

var StartPoint
var EndPoint

func _ready() -> void:
	_draw_line()
	_draw_path2D()

func _draw_line() -> void:
	#绘制可视线条
	StartPoint = get_node("/root/MainScene/AirShip/AirShip/cable_start_point").global_position
	EndPoint = get_node("/root/MainScene/Resturant/cable_end_point").global_position
	#获取屏幕尺寸
	var screen_rect = get_viewport_rect()
	var screen_width = screen_rect.size.x
	
	var new_points = [
		StartPoint,
		Vector2(screen_width-10,StartPoint.y),
		Vector2(screen_width-10,EndPoint.y),
		EndPoint
	]
	self.points = new_points
	
func _draw_path2D() ->void:
	#绘制Path2D
	var path2D = get_child(0)as Path2D
	path2D.curve.clear_points()
	if path2D is Path2D :
		for point in points:
			path2D.curve.add_point(point)
