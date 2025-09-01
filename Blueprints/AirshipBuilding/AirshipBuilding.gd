extends Node2D
class_name AirshipBuilding

enum mount_direction
{
	Top,
	Left,
	Bootom,
	Dynamic
}

#region AirshipBuilding 属性
var _mount_direction:mount_direction
var _cable_car_controller:Cable_Car_Controller
@export var docking_device:Docking_device
#endregion
func _init_building_message(direction:mount_direction)->void:
	_mount_direction = direction
