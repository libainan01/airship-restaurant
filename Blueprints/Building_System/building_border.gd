class_name Building_Border extends Area2D

enum BORDER_DIRECTION
{
	BOTTOM,
	LEFT
}

#region Building_Border 属性
var _border_height:int = 8
var _border_width:int = 1200
var _map_cells:Dictionary
var zoom:int
var _collision2D:CollisionShape2D
var _left_vertex:Vector2
var cell_size:Vector2
var border_direction:BORDER_DIRECTION
#endregion
func _init() -> void:
	_collision2D = CollisionShape2D.new()
	self.add_child(_collision2D)
	_collision2D.shape = RectangleShape2D.new()
	pass

func _init_map_cells()->void:
	var i:int = 0
	var j:int = 0
	
	while(i<_border_width):
		while(j<_border_height):
			_map_cells.get_or_add(Vector2(i,j),MapCellNode.new(null))
			j = j+1
		i = i+1
		
#region Builder_Border 接口
#根据格子索引，获得格子在border中的相对坐标
func get_cell_local_position(_index_w:int,_index_h:int)->Vector2:
	var cell_position = Vector2((_index_w * cell_size.x) + (cell_size.x*0.5),(_index_h * cell_size.y) + (cell_size.y * 0.5))
	return cell_position
#根据格子索引，获得格子在世界中的坐标
func get_cell_world_position(_index_w:int,_index_h:int)->Vector2:
	var cell_position = Vector2((_index_w * cell_size.x) + (cell_size.x*0.5),(_index_h * cell_size.y) + (cell_size.y * 0.5))
	return _get_global_location_by_position(Vector2(_index_w,_index_h))
#通过相对位置找到格子的索引
func get_cell_index_by_local_position(_vector2:Vector2)->Vector2:
	return Vector2( int(_vector2.x / cell_size.x),int(_vector2.y/cell_size.y))
#通过世界位置找到格子的索引
func get_cell_index_by_global_position(_vector2:Vector2)->Vector2:
	#需要将传入的数值限定在某个区间内
	var _temp_vector = Vector2(_vector2.x,clamp(_vector2.y,_left_vertex.y,9999999))
	var _local_position = _temp_vector - _left_vertex
	return get_cell_index_by_local_position(_local_position)
#endregion

func _get_global_location_by_position(_vector2:Vector2)->Vector2:
	var _border:RectangleShape2D = _collision2D.shape
	var _border_size:Vector2 = _border.size
	var _border_location:Vector2 =Vector2(0,global_position.y - (_border_size.y*0.5))
	return _border_location + _vector2
