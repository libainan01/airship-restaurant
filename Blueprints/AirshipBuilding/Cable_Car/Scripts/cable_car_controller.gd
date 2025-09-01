extends Node

var cable_car_class = preload("res://Blueprints/AirshipBuilding/Cable_Car/cable_car.tscn")

static var controller_instance:Cable_Car_Controller
#region CableCarController属性
var cable_car_array:Array[Cable_car]
var _max_length:float
static var _path2d:Path2D
var _cable:PathFollow2D
var main_scene:MainScene
#endregion

func _init() -> void:
	if controller_instance == null:
		controller_instance = self
	else:
		queue_free()

func _ready() -> void:
	main_scene = get_tree().root.get_child(2)
	var window = main_scene.get_child(0) as Window
	_max_length = sqrt((DisplayServer.window_get_size().x * DisplayServer.window_get_size().x) + (DisplayServer.window_get_size().y * DisplayServer.window_get_size().y))
	#创建Path2D
	_path2d = Path2D.new()
	_path2d.curve = Curve2D.new()
	var _screen_size = DisplayServer.window_get_size()
	update_move_path(DisplayServer.window_get_size())
	window.add_child.call_deferred(_path2d)
	#创建PathFollow2D
	_cable = PathFollow2D.new()
	_path2d.add_child(_cable)
	create_cable_car()

#region CableCarController 对外接口
func create_cable_car ()->void:
	cable_car_array.append(_install_cable_car())

func call_the_cable_car (task:Task)->Cable_car:
	var _target_cable_car:Cable_car = _find_suitable_cable_car(task.docking_device.get_link_position(),task.task_priority)
	_target_cable_car.send_task(task)
	return _target_cable_car

func update_move_path (end_point:Vector2)->void:
	var _screen_size = DisplayServer.screen_get_size()
	_path2d.curve.add_point(Vector2(0,0))
	_path2d.curve.add_point(Vector2(_screen_size.x,0))
	_path2d.curve.add_point(Vector2(_screen_size.x,end_point.y))
	_path2d.curve.add_point(end_point)

func foce_command (cable_car:Cable_car,task:Task)->void:
	cable_car.send_task(task)
#endregion

func _install_cable_car ()->Cable_car:
	var _cable_car = cable_car_class.instantiate() as Cable_car
	_cable_car._init_cable_car(_cable)
	_cable.add_child(_cable_car)
	return _cable_car

func _find_suitable_cable_car(task_position:Vector2,task_priority:int)->Cable_car:
	var _res :int = 999999
	var _target_cable_car:Cable_car = null
	for _cable_car in cable_car_array:
		var _pos = task_position - _cable_car.global_position as Vector2
		var _length =  sqrt((_pos.x * _pos.x) + (_pos.y * _pos.y))
		var _length_widget = _length / _max_length
		var _temp_res:int = _length_widget + _cable_car._task_progress + task_priority
		if _temp_res < _res :
			_res = _temp_res
			_target_cable_car = _cable_car
	return _target_cable_car
