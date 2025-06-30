class_name CableCarController
extends Node

#region CableCarController属性
var cable_car_array:Array[Cable_car]

func _ready() -> void:
	create_cable_car()

func create_cable_car ()->void:
	var _Cable = get_child(0).get_child(0) as Cable
	cable_car_array.append(_Cable.install_cable_car())

func call_the_cable_car (caller:Docking_device,task:Task)->void:
	
	pass
	
func _find_suitable_cable_car()->Cable_car:
	for _cable_car in cable_car_array:
		_cable_car._task_progress
	return null
