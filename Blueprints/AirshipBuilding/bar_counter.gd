extends AirshipBuilding
class_name  Bar_counter

#region Bar_counter属性
var _docking_device:Docking_device
#endregion

func _init() -> void:
	_mount_direction = mount_direction.Bootom

func _ready() -> void:
	_docking_device = get_child(1)
	update_bar_counter_position(global_position)
	get_window().size_changed.connect(_windows_size_change)
	AirshipWindowController.message_bottom_height_change.connect(_on_airship_window_change)


#region Bar_counter 对外接口
func get_docking_deveice() ->Docking_device:
	return _docking_device

func update_bar_counter_position(new_position:Vector2)->void:
	global_position = new_position
	Cable_Car_Controller.update_move_path(_docking_device.get_link_position())

func _windows_size_change()->void:
	print("window size : %s , %s",get_window().size.x,get_window().size.y)
	pass

func get_dish (dish_data:Dish)->void:
	
	pass
#endregion

#region 吧台回调函数
func _on_airship_window_change(bottom_heigth_offset:float)->void:
	update_bar_counter_position(Vector2(global_position.x,global_position.y - bottom_heigth_offset))

func _on_storage_message_is_empty() -> void:
	
	pass # Replace with function body.

func _on_storage_message_is_full() -> void:
	
	pass # Replace with function body.

func _on_storage_message_reserves_changed(last_reserves: int, current_reserves: Variant) -> void:
	
	pass # Replace with function body.

func _on_docking_device_message_docking_complete() -> void:
	pass # Replace with function body.
#endregion
