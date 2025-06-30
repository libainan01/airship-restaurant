class_name CableCarController
extends Node

#region CableCarController属性
var cable_car_array:Array[Cable_car]
var _max_length:float

func _ready() -> void:
	create_cable_car()
	_max_length = sqrt((DisplayServer.screen_get_size().x * DisplayServer.screen_get_size().x) + (DisplayServer.screen_get_size().y * DisplayServer.screen_get_size().y))

func create_cable_car ()->void:
	var _Cable = get_child(0).get_child(0) as Cable
	cable_car_array.append(_Cable.install_cable_car())

func call_the_cable_car (caller:Docking_device,task:Task)->Cable_car:
	var _target_cable_car:Cable_car = _find_suitable_cable_car(caller.get_link_position(),task.taks_priority)
	_target_cable_car.send_task(caller.get_link_position())
	return _target_cable_car

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
