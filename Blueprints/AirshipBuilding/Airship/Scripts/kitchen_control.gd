class_name kitchen_control extends Node
@onready var KitchenTimer = $KitchenTimer

#region kitchen_control属性
var task_map:Dictionary
@export var storage:Storage
var _temp_cable_car:Cable_car #呼叫中的临时Cable_car
var _linking_cable_car:Cable_car #已经停靠的Cable_car
#endregion

func _ready() -> void:
	start_cooking()
	_on_storage_message_is_full() #test

func start_cooking () ->void:
	KitchenTimer.start(3)

func end_cooking()-> void:
	#测试
	var test_dish = Dish.new(10,10,null) as Dish
	dining_out(test_dish)

func dining_out(dish:Dish)-> void:
	storage.add_object(dish)

#region kitchen_control回调函数
func _on_kitchen_timer_timeout() -> void:
	end_cooking() # Replace with function body.
	
func _on_storage_message_is_empty() -> void:
	pass # Replace with function body.
func _on_storage_message_is_full() -> void:
	_temp_cable_car = Cable_Car_Controller.call_the_cable_car(Task.new(1,get_parent().get_parent().docking_device))
	pass # Replace with function body.
func _on_storage_message_reserves_changed(last_reserves: int, current_reserves: Variant) -> void:
	pass # Replace with function body.
func _on_docking_device_message_docking_complete(link_docking_device: Docking_device) -> void:
	storage.transferring_inventory(link_docking_device._owner_storage)
	link_docking_device.start_the_separate_process()#物品转移完成，开始分离
	_linking_cable_car = _temp_cable_car
	Cable_Car_Controller.foce_command(_linking_cable_car,Task.new(1,get_parent().get_parent().docking_device))
	_temp_cable_car = null
	_linking_cable_car = null
#endregion
