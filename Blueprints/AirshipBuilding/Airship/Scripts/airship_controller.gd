class_name MainShipController
extends Area2D

#region key

var _left_hoding_trigger_time = 0.5
var _left_time = 0
#Key
var _is_mouse_enter = false
var _isAirshipMoved = true
var _mouse_left_button_pressed = false

#glob_porprty
var main_scene:MainScene

#endregion
func _ready() -> void:
	input_pickable = true;
	main_scene = get_tree().root.get_child(2)
	_add_new_collison_space()

func _process(delta: float) -> void:
	if _mouse_left_button_pressed:
		_left_time += delta
		if _left_time > _left_hoding_trigger_time :
			_mouse_left_hold()
	pass
#region 按键输入监听

func _input(event: InputEvent) -> void:
	pass


func _on_input_event(viewport: Node, event: InputEvent, shape_idx: int) -> void:
	print("on_input_event")
	if event is InputEventMouseButton:#监听鼠标点击事件
		if event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			_mouse_left_click()
		if event.button_index == MOUSE_BUTTON_LEFT and !event.pressed:
			_mouse_left_release()

#endregion

#region 鼠标点击事件
# -------------Mouse Button Event------------------#
func _mouse_left_click() -> void:
	_mouse_left_button_pressed = true
	AirshipWindowController.special_shaped_window.delete_list(self)
	pass
func _mouse_left_release() ->void:
	if _mouse_left_button_pressed: _add_new_collison_space()
	_mouse_left_button_pressed = false
	_left_time = 0

func _mouse_left_hold() ->void:
	_move_airship(get_global_mouse_position())
# -------------Mouse Button Event------------------#
#endregion

func _move_airship(_position:Vector2) ->void:
	var Airship = get_parent()
	Airship.global_position = Vector2(_position.x,get_parent().global_position.y)
	_isAirshipMoved = true

func add_debug_point (position: Vector2 ,color: Color = Color.RED,size: float = 5.0) ->void:
	var line = Line2D.new()
	line.add_point(Vector2(0,0))
	line.default_color = color
	line.width = size
	add_child(line)
	line.global_position = position

func _on_mouse_entered() -> void:
	_is_mouse_enter = true

func _on_mouse_exited() -> void:
	_is_mouse_enter = false
	_mouse_left_release()
	
#----------------Mouse Collison Space--------------------#
func _add_new_collison_space () ->void:
	var CollisionShape = get_child(0) as CollisionShape2D
	var CenterPoint = CollisionShape.global_position
	var RectangleShape = CollisionShape.shape as RectangleShape2D
	#var size = RectangleShape.size as Vector2
	var size = Vector2(150,150)
	
	var LeftPointOne = SpecialShapedWindow.PolygonPoint.new(Vector2i(CenterPoint.x - (size.x/2),0))
	LeftPointOne.next_point = SpecialShapedWindow.PolygonPoint.new(Vector2i(CenterPoint.x - (size.x/2),CenterPoint.y + (size.y/2)))
	LeftPointOne.next_point.last_point = LeftPointOne
	LeftPointOne.next_point.next_point = SpecialShapedWindow.PolygonPoint.new(Vector2i(CenterPoint.x + (size.x/2),CenterPoint.y + (size.y/2)))
	LeftPointOne.next_point.next_point.last_point = LeftPointOne.next_point.next_point
	LeftPointOne.next_point.next_point.next_point = SpecialShapedWindow.PolygonPoint.new(Vector2i(CenterPoint.x + (size.x/2),0))
	LeftPointOne.next_point.next_point.next_point.last_point = LeftPointOne.next_point.next_point.next_point
	
	var RightBottomPoint = Vector2i(CenterPoint.x + (size.x/2),CenterPoint.y + (size.y/2)) as Vector2i
	AirshipWindowController.special_shaped_window.insert_list(LeftPointOne,LeftPointOne.next_point.next_point.next_point,self,AirshipWindowController.special_shaped_window.PointType.TOP_LEFT,AirshipWindowController.special_shaped_window.PointType.TOP_RIGHT)
	AirshipWindowController.special_shaped_window.redraw_mouse_passthrough_polygon()
